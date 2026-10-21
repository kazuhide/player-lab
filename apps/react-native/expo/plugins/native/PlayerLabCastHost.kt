package __PLAYER_LAB_PACKAGE__

import android.content.Context
import com.bitmovin.player.casting.BitmovinCastManager
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ViewManager

/** Native startup adapter; it never modifies the SDK or stores player credentials. */
class PlayerLabCastHost(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "PlayerLabCastHost"

    @ReactMethod
    fun readOptions(promise: Promise) {
        promise.resolve(state(reactApplicationContext))
    }

    @ReactMethod
    fun saveOptions(applicationId: String, messageNamespace: String, promise: Promise) {
        try {
            require(applicationId.isEmpty() || applicationId.matches(Regex("[0-9a-fA-F]{8}"))) {
                "Enter an eight-character hexadecimal Cast receiver ID or leave it blank."
            }
            require(messageNamespace.isEmpty() || (messageNamespace.length <= 128 &&
                messageNamespace.startsWith("urn:x-cast:") && messageNamespace.length > 11 &&
                messageNamespace.all { it.code in 33..126 })) {
                "Enter a Cast namespace beginning with urn:x-cast: (at most 128 ASCII characters), or leave it blank."
            }
            check(preferences(reactApplicationContext).edit()
                .putString("applicationId", applicationId)
                .putString("messageNamespace", messageNamespace).commit()) { "The Cast settings could not be saved." }
            promise.resolve(state(reactApplicationContext))
        } catch (error: Exception) {
            promise.reject("CastHostSettings", error.message, error)
        }
    }

    companion object {
        private const val DEFAULT_ID = "FFE417E5"
        private const val DEFAULT_NAMESPACE = "urn:x-cast:com.bitmovin.player.caf"
        private fun preferences(context: Context) = context.getSharedPreferences("player-lab-cast", Context.MODE_PRIVATE)
        private fun saved(context: Context): Pair<String, String> {
            val values = preferences(context)
            return Pair(values.getString("applicationId", "") ?: "", values.getString("messageNamespace", "") ?: "")
        }
        private fun normalized(values: Pair<String, String>) = Pair(
            values.first.ifEmpty { DEFAULT_ID }, values.second.ifEmpty { DEFAULT_NAMESPACE })
        private fun valuesMap(values: Pair<String, String>) = Arguments.createMap().apply {
            putString("applicationId", values.first); putString("messageNamespace", values.second)
        }

        /** Called before Expo's SDK lifecycle listener first initializes Cast. */
        fun initializeSavedOptions(context: Context) {
            val values = normalized(saved(context))
            BitmovinCastManager.initialize(values.first, values.second)
        }

        private fun state(context: Context): WritableMap {
            val saved = saved(context)
            val initialized = BitmovinCastManager.isInitialized()
            val actual = if (initialized) BitmovinCastManager.getInstance().let {
                Pair(it.applicationId ?: DEFAULT_ID, it.messageNamespace ?: DEFAULT_NAMESPACE)
            } else null
            return Arguments.createMap().apply {
                putMap("savedOptions", valuesMap(saved))
                if (actual == null) putNull("startupOptions") else putMap("startupOptions", valuesMap(actual))
                putBoolean("nativeInitialized", initialized)
                putBoolean("pendingRestart", actual != normalized(saved))
                putString("startupEvidence", "Read from the current public native BitmovinCastManager getters.")
            }
        }
    }
}

class PlayerLabCastHostPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext) = listOf(PlayerLabCastHost(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
