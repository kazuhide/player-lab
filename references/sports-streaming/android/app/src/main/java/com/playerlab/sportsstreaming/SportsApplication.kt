package com.playerlab.sportsstreaming

import android.app.Application
import com.bitmovin.player.casting.BitmovinCastManager

class SportsApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // https://github.com/bitmovin/bitmovin-player-android-samples/tree/main/BasicCasting
        BitmovinCastManager.initialize()
    }
}
