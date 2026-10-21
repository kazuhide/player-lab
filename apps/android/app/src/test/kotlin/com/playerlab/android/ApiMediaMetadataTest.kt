package com.playerlab.android

import com.bitmovin.player.api.media.session.MediaSessionSourceConfig
import com.bitmovin.player.api.media.session.MediaMetadata
import com.bitmovin.player.api.media.session.Rating
import org.junit.Assert.*
import org.junit.Test

class ApiMediaMetadataTest {
    @Test fun allMetadataFamiliesReachTheirNativeSdkValues() {
        val input = "displayTitle=Sample\nartist=Artist\nduration=60000\ntrackNumber=2\ntotalTrackCount=8\nisPlayable=true\nisBrowsable=false\nreleaseYear=2026\nreleaseMonth=10\nreleaseDay=22\nmediaType=Movie\nuserRating=Star:5:4.5\noverallRating=Heart:true"
        val config = ApiOverrides.validate(mapOf("android:com.bitmovin.player.api.media.session.MediaSessionSourceConfig.Enabled.mediaMetadata" to input)).mediaSession() as MediaSessionSourceConfig.Enabled
        val metadata = config.mediaMetadata
        assertEquals("Sample", metadata.displayTitle)
        assertEquals("Artist", metadata.artist)
        assertEquals(60000L, metadata.duration)
        assertEquals(2, metadata.trackNumber)
        assertEquals(8, metadata.totalTrackCount)
        assertEquals(true, metadata.isPlayable)
        assertEquals(false, metadata.isBrowsable)
        assertEquals(10, metadata.releaseMonth)
        assertEquals(MediaMetadata.MediaType.Movie, metadata.mediaType)
        assertEquals(Rating.Star(5, 4.5f), metadata.userRating)
        assertEquals(Rating.Heart(true), metadata.overallRating)
    }
    @Test fun invalidValuesAreRejectedBeforeSourceFactoryAndNullableRatingsStayUnrated() {
        for (value in listOf("unknown=value", "releaseMonth=13", "duration=-1", "isPlayable=yes", "userRating=Percentage:101", "userRating=Star:5:6"))
            assertTrue(value, runCatching { ApiMediaMetadata.parse(value) }.isFailure)
        val metadata = ApiMediaMetadata.parse("userRating=Thumb:null\noverallRating=null\nartist=null")
        assertEquals(Rating.Thumb(null), metadata.userRating)
        assertNull(metadata.overallRating)
        assertNull(metadata.artist)
    }
}
