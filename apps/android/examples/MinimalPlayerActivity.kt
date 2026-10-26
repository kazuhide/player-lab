package com.example.playerguide

import android.app.Activity
import android.content.res.Configuration
import android.os.Bundle
import android.util.Log
import com.bitmovin.player.PlayerView
import com.bitmovin.player.api.Player
import com.bitmovin.player.api.PlayerConfig
import com.bitmovin.player.api.PlaybackConfig
import com.bitmovin.player.api.event.PlayerEvent
import com.bitmovin.player.api.event.SourceEvent
import com.bitmovin.player.api.source.Source
import com.bitmovin.player.api.source.SourceConfig
import com.bitmovin.player.api.source.SourceType
import com.bitmovin.player.api.ui.PlayerViewConfig
import com.bitmovin.player.api.ui.UiConfig

class MinimalPlayerActivity : Activity() {
    private lateinit var player: Player
    private lateinit var playerView: PlayerView
    private lateinit var source: Source
    private var released = false
    private val playerError: (PlayerEvent.Error) -> Unit = {
        if (!released) Log.e("MinimalPlayer", "Player error ${it.code.value}")
    }
    private val sourceError: (SourceEvent.Error) -> Unit = {
        if (!released) Log.e("MinimalPlayer", "Source error ${it.code.value}")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val config = PlayerConfig(
            key = "YOUR_PLAYER_KEY",
            playbackConfig = PlaybackConfig(isAutoplayEnabled = true, isMuted = true),
        )
        player = Player(this, config)
        player.on(PlayerEvent.Error::class, playerError)
        val television = resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK ==
            Configuration.UI_MODE_TYPE_TELEVISION
        val viewConfig = if (television) PlayerViewConfig(uiConfig = UiConfig.WebUi(
            variant = UiConfig.WebUi.Variant.TvUi,
            focusUiOnInitialization = true,
        )) else PlayerViewConfig()
        playerView = PlayerView(this, player, viewConfig)
        setContentView(playerView)
        source = Source(SourceConfig("https://example.com/video/master.m3u8", SourceType.Hls))
        source.on(SourceEvent.Error::class, sourceError)
        player.load(source)
    }

    override fun onStart() {
        super.onStart()
        playerView.onStart()
    }

    override fun onResume() {
        super.onResume()
        playerView.onResume()
    }

    override fun onPause() {
        playerView.onPause()
        super.onPause()
    }

    override fun onStop() {
        playerView.onStop()
        super.onStop()
    }

    override fun onDestroy() {
        released = true
        source.off(SourceEvent.Error::class, sourceError)
        player.off(PlayerEvent.Error::class, playerError)
        playerView.player = null
        playerView.onDestroy()
        player.destroy()
        super.onDestroy()
    }
}
