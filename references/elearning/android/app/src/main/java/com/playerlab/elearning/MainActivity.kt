package com.playerlab.elearning

import android.app.AlertDialog
import android.os.Bundle
import android.content.res.Configuration
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.graphics.Rect
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.viewModels
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private val session: PlaybackSession by viewModels()
    private lateinit var frame: FrameLayout
    private lateinit var header: LinearLayout
    private lateinit var contentRoot: LinearLayout
    private lateinit var title: android.widget.TextView
    private lateinit var learner: android.widget.Button
    private lateinit var back: android.widget.ImageButton
    private var courseScreen: CourseScreen? = null
    private var lessonScreen: LessonScreen? = null
    private var sceneType: AppScreen? = null
    private var scenePlayer: com.bitmovin.player.api.Player? = null
    private var started = false
    private var resumed = false
    private var rendering = false
    private var inspector: EventInspector? = null
    private var saveFailureShown = false
    private val audioRouteReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) session.onAudioRouteLost()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val root = column().apply { setBackgroundColor(LearningColors.background) }
        contentRoot = root
        header = row().apply { setPadding(dp(12), dp(4), dp(12), dp(4)) }
        back = iconAction(R.drawable.ic_back, R.string.back) { session.returnToCourse() }
        title = heading(getString(R.string.app_name), 18f).apply {
            isSingleLine = true
            ellipsize = android.text.TextUtils.TruncateAt.END
            gravity = android.view.Gravity.CENTER_VERTICAL
            minimumHeight = dp(48)
        }
        learner = action(session.learner.name) { chooseLearner() }.apply {
            minimumWidth = 0
            minWidth = 0
            setPadding(0, 0, 0, 0)
            layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
        }
        header.addView(back)
        header.weighted(title)
        header.addView(learner)
        header.addView(iconAction(R.drawable.ic_more, R.string.more_options) {
            val anchor = header.getChildAt(header.childCount - 1)
            android.widget.PopupMenu(this, anchor).apply {
                menu.add(R.string.diagnostics).setOnMenuItemClickListener {
                    inspector?.dismiss()
                    inspector = EventInspector(this@MainActivity, session).also { it.show() }
                    true
                }
                show()
            }
        })
        root.addView(header)
        frame = FrameLayout(this)
        root.addView(frame, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        setContentView(root)
        session.onChanged = ::render
        session.beforePlayerReplacement = ::disposeScene
        if (BuildConfig.DEBUG && session.player.source == null) intent.getStringExtra("mediaBaseUrl")?.let(session::configureMediaForTest)
        if (BuildConfig.DEBUG && intent.hasExtra("spikeSourceUrl")) {
            session.loadSpike(requireNotNull(intent.getStringExtra("spikeSourceUrl")), intent.getStringExtra("spikeSubtitleUrl"))
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    session.viewState.fullscreen -> setFullscreen(false)
                    session.screen == AppScreen.LESSON -> session.returnToCourse()
                    else -> finish()
                }
            }
        })
        render()
        if (session.viewState.fullscreen) setFullscreen(true)
    }

    override fun attachBaseContext(newBase: Context) {
        val language = GuideLocaleOverride.language
        val scale = GuideLocaleOverride.fontScale
        val localized = if (BuildConfig.DEBUG && (language != null || scale != null)) {
            val config = Configuration(newBase.resources.configuration).apply {
                language?.let { setLocale(java.util.Locale.forLanguageTag(it)) }
                scale?.let { fontScale = it }
            }
            newBase.createConfigurationContext(config)
        } else newBase
        super.attachBaseContext(localized)
    }

    private fun render() {
        if (!::frame.isInitialized || rendering || isFinishing) return
        rendering = true
        try {
            if (sceneType != session.screen || scenePlayer !== session.player) {
                disposeScene()
                sceneType = session.screen
                scenePlayer = session.player
                val view = if (session.screen == AppScreen.COURSE) CourseScreen(this, session, ::openLesson).also { courseScreen = it }
                else LessonScreen(this, session, ::openLesson, ::setFullscreen).also {
                    lessonScreen = it
                    if (started) it.surface.onStart()
                    if (resumed) it.surface.onResume()
                }
                frame.addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            }
            val heading = if (session.screen == AppScreen.LESSON) session.activeItem?.lesson?.localizedTitle(this) ?: getString(R.string.spike_title) else getString(R.string.app_name)
            if (title.text.toString() != heading) { title.text = heading; title.contentDescription = heading }
            if (learner.text.toString() != session.learner.name) learner.text = session.learner.name
            learner.contentDescription = getString(R.string.learner, session.learner.name)
            back.visibility = if (session.screen == AppScreen.LESSON) View.VISIBLE else View.GONE
            header.visibility = if (session.viewState.fullscreen) View.GONE else View.VISIBLE
            courseScreen?.update()
            lessonScreen?.update()
            inspector?.update()
            if (session.saveFailed && !saveFailureShown) android.widget.Toast.makeText(this, R.string.save_failed, android.widget.Toast.LENGTH_LONG).show()
            saveFailureShown = session.saveFailed
        } finally { rendering = false }
    }
    private fun disposeScene() {
        lessonScreen?.release()
        lessonScreen = null
        courseScreen = null
        frame.removeAllViews()
        sceneType = null
        scenePlayer = null
    }
    private fun openLesson(id: String) {
        if (session.progressLoading) return
        val saved = session.resumes[id]
        val lesson = requireNotNull(session.catalog).lesson(id)
        if (saved == null || saved.positionMs == 0L) { session.startLesson(id); return }
        val dialog = AlertDialog.Builder(this).setTitle(lesson.localizedTitle(this))
        if (saved.canResume(lesson.durationMs)) dialog.setMessage(getString(R.string.saved_position, formatTime(saved.positionMs)))
            .setPositiveButton(R.string.continue_lesson) { _, _ -> session.startLesson(id, resume = true) }
        else dialog.setMessage(R.string.saved_invalid)
        dialog.setNeutralButton(R.string.start_over) { _, _ -> session.startLesson(id) }.setNegativeButton(R.string.cancel, null).show()
    }
    private fun chooseLearner() {
        val learners = Learner.entries
        AlertDialog.Builder(this).setTitle(R.string.choose_learner)
            .setSingleChoiceItems(learners.map { getString(R.string.learner, it.name) }.toTypedArray(), learners.indexOf(session.learner)) { dialog, index ->
                session.switchLearner(learners[index]); dialog.dismiss()
            }.setNegativeButton(R.string.cancel, null).show()
    }
    private fun setFullscreen(enabled: Boolean) {
        session.viewState.fullscreen = enabled
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        if (enabled) controller.hide(WindowInsetsCompat.Type.systemBars()) else controller.show(WindowInsetsCompat.Type.systemBars())
        render()
    }

    fun setUiMode(mode: UiMode) { session.uiMode = mode; render() }
    fun snapshot() = session.snapshot(lessonScreen?.surface?.playerViewCount ?: 0, lessonScreen?.surface?.subtitleViewCount ?: 0)
    fun playForTest() { check(BuildConfig.DEBUG); session.player.play() }
    fun preparePausedTestState() {
        check(BuildConfig.DEBUG)
        session.player.pause()
        session.player.playbackSpeed = 1.5f
        session.player.source?.let { source -> source.availableSubtitleTracks.firstOrNull()?.let { source.setSubtitleTrack(it.id) } }
    }
    fun sessionForTest(): PlaybackSession { check(BuildConfig.DEBUG); return session }
    fun requestSdkFullscreenForTest(enabled: Boolean) { check(BuildConfig.DEBUG); lessonScreen?.surface?.requestSdkFullscreenForTest(enabled) }
    fun screenshotBoundsForTest(): Rect {
        check(BuildConfig.DEBUG)
        val location = IntArray(2).also(contentRoot::getLocationInWindow)
        return Rect(location[0] + contentRoot.paddingLeft, location[1] + contentRoot.paddingTop,
            location[0] + contentRoot.width - contentRoot.paddingRight, location[1] + contentRoot.height - contentRoot.paddingBottom)
    }
    override fun onStart() {
        super.onStart()
        ContextCompat.registerReceiver(this, audioRouteReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED)
        started = true
        lessonScreen?.surface?.onStart()
        session.onForeground()
    }
    override fun onResume() { super.onResume(); resumed = true; lessonScreen?.surface?.onResume() }
    override fun onPause() {
        resumed = false
        if (isChangingConfigurations) session.onRotation()
        else { session.onBackground(); lessonScreen?.surface?.onPause() }
        super.onPause()
    }
    override fun onStop() {
        unregisterReceiver(audioRouteReceiver)
        started = false
        if (!isChangingConfigurations) lessonScreen?.surface?.onStop()
        super.onStop()
    }
    override fun onDestroy() {
        session.onChanged = null
        session.beforePlayerReplacement = null
        inspector?.dismiss()
        disposeScene()
        super.onDestroy()
    }
}
