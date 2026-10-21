package com.playerlab.android

import android.content.Context
import android.graphics.SurfaceTexture
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import android.os.Handler
import android.os.Looper
import android.view.Surface
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.vr.VrContentType
import com.bitmovin.player.api.vr.VrRenderer
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/**
 * A public-API VR host: decoded frames reach a real external texture and are
 * projected using the source layout and the SDK's current viewing direction.
 * https://developer.android.com/reference/android/graphics/SurfaceTexture
 * https://developer.android.com/reference/android/opengl/GLSurfaceView.Renderer
 */
internal class ApiVrRenderer(
    context: Context,
    private val player: Player,
    private val owns: () -> Boolean,
    private val report: (String) -> Unit,
) : GLSurfaceView(context), GLSurfaceView.Renderer, VrRenderer {
    private class Texture(val id: Int, val image: SurfaceTexture, val surface: Surface) {
        val available = AtomicBoolean()
        var hasImage = false
        private val released = AtomicBoolean()
        fun release() {
            if (!released.compareAndSet(false, true)) return
            image.setOnFrameAvailableListener(null)
            surface.release()
            image.release()
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private val closed = AtomicBoolean()
    private val failed = AtomicBoolean()
    private val updates = CopyOnWriteArraySet<VrRenderer.UpdateCallback>()
    private val images = CopyOnWriteArraySet<Texture>()
    private val decoded = AtomicLong()
    private val drawn = AtomicLong()
    private val updated = AtomicLong()
    private val sourceChanges = AtomicLong()
    @Volatile private var projection = VrContentType.None
    @Volatile private var texture: Texture? = null
    @Volatile private var previousFrame = 0L
    private var attached: Texture? = null // Main-thread ownership only.
    private var width = 1
    private var height = 1
    private var program = 0
    private var position = -1
    private var textureMatrixLocation = -1
    private var rotationLocation = -1
    private var scaleLocation = -1
    private var aspectLocation = -1
    private var layoutLocation = -1
    private var eyeLocation = -1
    private var videoLocation = -1
    private val textureMatrix = FloatArray(16)
    private val rotation = FloatArray(16)
    private val vertices = ByteBuffer.allocateDirect(8 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
        put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)); position(0)
    }

    init {
        setEGLContextClientVersion(2)
        preserveEGLContextOnPause = true
        setRenderer(this)
        // VR orientation must update while video is paused, at the display's rate.
        renderMode = RENDERMODE_CONTINUOUSLY
        contentDescription = "Player Lab VR surface"
    }

    val decodedFrames: Long get() = decoded.get()
    val drawnFrames: Long get() = drawn.get()
    val callbackCalls: Long get() = updated.get()
    val sourceUpdates: Long get() = sourceChanges.get()
    val callbackCount: Int get() = updates.size
    val hasFailed: Boolean get() = failed.get()

    override fun setSourceConfig(sourceConfig: SourceConfig?) {
        if (closed.get()) return
        projection = sourceConfig?.vrConfig?.vrContentType ?: VrContentType.None
        sourceChanges.incrementAndGet()
        requestRender()
    }

    override fun addUpdateCallback(updateCallback: VrRenderer.UpdateCallback) {
        if (closed.get()) return
        updates.add(updateCallback)
    }

    override fun removeUpdateCallback(updateCallback: VrRenderer.UpdateCallback) {
        updates.remove(updateCallback)
    }

    override fun onResume() {
        if (closed.get()) return
        previousFrame = 0
        super.onResume()
    }

    /** Call before removing the View or replacing its Player. */
    fun close() {
        check(Looper.myLooper() === Looper.getMainLooper())
        if (!closed.compareAndSet(false, true)) return
        main.removeCallbacksAndMessages(null)
        var failure: Exception? = null
        if (owns() && !player.isDestroyed) {
            try { player.vr.setVrRenderer(null) } catch (error: Exception) { failure = error }
            try { if (attached != null) player.setSurface(null as Surface?) }
            catch (error: Exception) { if (failure == null) failure = error }
        }
        attached = null
        updates.clear()
        // Buffer handles do not require a current GL context and can be released
        // even when a detached/paused surface no longer has a rendering thread.
        images.forEach(Texture::release)
        images.clear()
        queueEvent {
            texture?.let { GLES20.glDeleteTextures(1, intArrayOf(it.id), 0) }
            texture = null
            if (program != 0) GLES20.glDeleteProgram(program)
            program = 0
        }
        super.onPause()
        failure?.let { throw it }
    }

    override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
        if (closed.get() || failed.get()) return
        try {
            // EGL context loss deletes the previous GL objects automatically.
            program = createProgram(VERTEX_SHADER, FRAGMENT_SHADER)
            position = GLES20.glGetAttribLocation(program, "aPosition")
            textureMatrixLocation = GLES20.glGetUniformLocation(program, "uTextureMatrix")
            rotationLocation = GLES20.glGetUniformLocation(program, "uRotation")
            scaleLocation = GLES20.glGetUniformLocation(program, "uScale")
            aspectLocation = GLES20.glGetUniformLocation(program, "uAspect")
            layoutLocation = GLES20.glGetUniformLocation(program, "uLayout")
            eyeLocation = GLES20.glGetUniformLocation(program, "uEye")
            videoLocation = GLES20.glGetUniformLocation(program, "uVideo")
            val names = IntArray(1)
            GLES20.glGenTextures(1, names, 0)
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, names[0])
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            val image = SurfaceTexture(names[0])
            val next = Texture(names[0], image, Surface(image))
            images.add(next)
            image.setOnFrameAvailableListener { if (!closed.get()) { next.available.set(true); requestRender() } }
            texture = next
            previousFrame = 0
            main.post {
                if (closed.get() || failed.get() || !owns() || player.isDestroyed || texture !== next) {
                    images.remove(next); next.release()
                } else {
                    try {
                        player.setSurface(next.surface)
                        attached = next
                        images.filter { it !== next }.forEach { images.remove(it); it.release() }
                    } catch (error: Exception) { fail(error) }
                }
            }
        } catch (error: Exception) { fail(error) }
    }

    override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
        this.width = width.coerceAtLeast(1)
        this.height = height.coerceAtLeast(1)
    }

    override fun onDrawFrame(gl: GL10?) {
        if (closed.get() || failed.get()) return
        try {
            val now = System.nanoTime()
            val delta = if (previousFrame == 0L) 0.0 else (now - previousFrame).coerceAtLeast(0) / 1_000_000_000.0
            previousFrame = now
            // Update callbacks drive the SDK's orientation before it is sampled.
            for (callback in updates) {
                if (closed.get()) return
                callback.update(delta)
                updated.incrementAndGet()
            }
            val current = texture ?: return
            if (current.available.getAndSet(false)) {
                current.image.updateTexImage()
                current.image.getTransformMatrix(textureMatrix)
                current.hasImage = true
                decoded.incrementAndGet()
            }
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            if (!current.hasImage) return
            val vr = player.vr
            val direction = vr.viewingDirection
            Matrix.setIdentityM(rotation, 0)
            if (direction != null) {
                Matrix.rotateM(rotation, 0, -direction.yaw.toFloat(), 0f, 1f, 0f)
                Matrix.rotateM(rotation, 0, direction.pitch.toFloat(), 1f, 0f, 0f)
                Matrix.rotateM(rotation, 0, -direction.roll.toFloat(), 0f, 0f, 1f)
            }
            GLES20.glUseProgram(program)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, current.id)
            GLES20.glUniform1i(videoLocation, 0)
            GLES20.glUniformMatrix4fv(textureMatrixLocation, 1, false, textureMatrix, 0)
            GLES20.glUniformMatrix4fv(rotationLocation, 1, false, rotation, 0)
            GLES20.glUniform1i(layoutLocation, when (projection) {
                VrContentType.Single -> 1
                VrContentType.Sbs -> 2
                VrContentType.Tab -> 3
                else -> 0
            })
            vertices.position(0)
            GLES20.glEnableVertexAttribArray(position)
            GLES20.glVertexAttribPointer(position, 2, GLES20.GL_FLOAT, false, 0, vertices)
            val stereo = projection != VrContentType.None && vr.isStereo
            val eyes = if (stereo) 2 else 1
            val video = player.playbackVideoData
            for (eye in 0 until eyes) {
                val left = eye * width / eyes
                val eyeWidth = (eye + 1) * width / eyes - left
                val aspect = eyeWidth.toFloat() / height
                val videoAspect = if (video != null && video.height > 0 && video.width > 0) video.width.toFloat() / video.height else aspect
                GLES20.glViewport(left, 0, eyeWidth, height)
                GLES20.glUniform1f(aspectLocation, aspect)
                GLES20.glUniform1f(eyeLocation, eye.toFloat())
                if (projection == VrContentType.None) GLES20.glUniform2f(scaleLocation,
                    (videoAspect / aspect).coerceAtMost(1f), (aspect / videoAspect).coerceAtMost(1f))
                else GLES20.glUniform2f(scaleLocation, 1f, 1f)
                GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            }
            GLES20.glDisableVertexAttribArray(position)
            check(GLES20.glGetError() == GLES20.GL_NO_ERROR) { "OpenGL drawing failed." }
            drawn.incrementAndGet()
        } catch (error: Exception) { fail(error) }
    }

    private fun fail(error: Exception) {
        if (!failed.compareAndSet(false, true)) return
        main.post {
            if (!closed.get() && owns()) {
                try { if (attached != null && !player.isDestroyed) player.setSurface(null as Surface?) }
                catch (_: Exception) { /* Preserve the original renderer failure in the visible result. */ }
                attached = null
                report("VR renderer failed (${error.javaClass.simpleName}). Restore the normal PlayerView to continue.")
            }
        }
    }

    private fun createProgram(vertex: String, fragment: String): Int {
        fun compile(type: Int, text: String): Int {
            val shader = GLES20.glCreateShader(type)
            GLES20.glShaderSource(shader, text)
            GLES20.glCompileShader(shader)
            val result = IntArray(1)
            GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, result, 0)
            if (result[0] == 0) { GLES20.glDeleteShader(shader); error("OpenGL shader compilation failed.") }
            return shader
        }
        val vertexShader = compile(GLES20.GL_VERTEX_SHADER, vertex)
        val fragmentShader = try { compile(GLES20.GL_FRAGMENT_SHADER, fragment) }
        catch (error: Exception) { GLES20.glDeleteShader(vertexShader); throw error }
        val result = GLES20.glCreateProgram()
        try {
            GLES20.glAttachShader(result, vertexShader)
            GLES20.glAttachShader(result, fragmentShader)
            GLES20.glLinkProgram(result)
            val linked = IntArray(1)
            GLES20.glGetProgramiv(result, GLES20.GL_LINK_STATUS, linked, 0)
            check(linked[0] != 0) { "OpenGL shader linking failed." }
            return result
        } catch (error: Exception) { GLES20.glDeleteProgram(result); throw error }
        finally { GLES20.glDeleteShader(vertexShader); GLES20.glDeleteShader(fragmentShader) }
    }

    companion object {
        private const val VERTEX_SHADER = """
            attribute vec2 aPosition;
            uniform vec2 uScale;
            varying vec2 vPosition;
            void main() {
                vPosition = aPosition;
                gl_Position = vec4(aPosition * uScale, 0.0, 1.0);
            }
        """
        private const val FRAGMENT_SHADER = """
            #extension GL_OES_EGL_image_external : require
            precision mediump float;
            uniform samplerExternalOES uVideo;
            uniform mat4 uTextureMatrix;
            uniform mat4 uRotation;
            uniform float uAspect;
            uniform int uLayout;
            uniform float uEye;
            varying vec2 vPosition;
            void main() {
                vec2 uv = vPosition * 0.5 + 0.5;
                if (uLayout != 0) {
                    vec3 ray = normalize((uRotation * vec4(vPosition.x * uAspect, vPosition.y, -1.0, 0.0)).xyz);
                    uv = vec2(atan(ray.x, -ray.z) / 6.28318530718 + 0.5, asin(clamp(ray.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
                    if (uLayout == 2) uv.x = (uv.x + uEye) * 0.5;
                    if (uLayout == 3) uv.y = (uv.y + 1.0 - uEye) * 0.5;
                }
                uv = (uTextureMatrix * vec4(uv, 0.0, 1.0)).xy;
                gl_FragColor = texture2D(uVideo, uv);
            }
        """
    }
}
