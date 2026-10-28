package com.playerlab.elearning

enum class UiMode { DEFAULT, LEARNING }

data class PlaybackSnapshot(
    val playerIdentity: Int,
    val sourceIdentity: Int,
    val time: Double,
    val duration: Double,
    val speed: Float,
    val subtitleId: String?,
    val playing: Boolean,
    val destroyed: Boolean,
    val impressionId: String?,
    val loads: Int,
    val seeks: Int,
    val frames: Long,
    val playerViews: Int,
    val subtitleViews: Int,
    val errorCode: String?,
)
