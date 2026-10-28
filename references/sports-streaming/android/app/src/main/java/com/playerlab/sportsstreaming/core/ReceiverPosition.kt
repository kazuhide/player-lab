package com.playerlab.sportsstreaming.core

data class ReceiverPosition(val sourcePositionMs: Long?, val viewedUtcMs: Long?) {
    companion object {
        fun resolve(kind: AssetKind, cafPositionMs: Long?, sdk: SourceUtcReading,
                    request: PlaybackRequest?, originMs: Long?): ReceiverPosition {
            if (cafPositionMs == null || cafPositionMs < 0) return ReceiverPosition(null, null)
            if (kind != AssetKind.LIVE) return ReceiverPosition(cafPositionMs, null)
            val utc = sdk.viewedUtcMs?.takeIf { sdk.sourceIsCurrent && request != null && sdk.request == request &&
                originMs != null && it >= originMs } ?: return ReceiverPosition(null, null)
            return ReceiverPosition(utc - requireNotNull(originMs), utc)
        }
    }
}
