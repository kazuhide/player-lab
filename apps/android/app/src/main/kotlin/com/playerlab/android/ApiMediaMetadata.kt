package com.playerlab.android

import com.bitmovin.player.api.media.session.MediaMetadata
import com.bitmovin.player.api.media.session.Rating

/** Every accepted key has an explicit SDK builder call and value contract. */
internal object ApiMediaMetadata {
    private fun nullable(value: String) = value.takeUnless { it == "null" }
    private fun integer(value: String, minimum: Int = 0, maximum: Int = Int.MAX_VALUE): Int? = nullable(value)?.let {
        val n = it.toIntOrNull() ?: error("Enter a whole integer or null.")
        require(n in minimum..maximum)
        n
    }
    private fun boolean(value: String) = nullable(value)?.toBooleanStrictOrNull() ?: if (value == "null") null else error("Enter true, false or null.")
    private fun rating(value: String): Rating? {
        if (value == "null") return null
        val parts = value.split(':')
        return when (parts.first()) {
            "Heart" -> { require(parts.size == 2); Rating.Heart(boolean(parts[1])) }
            "Thumb" -> { require(parts.size == 2); Rating.Thumb(boolean(parts[1])) }
            "Percentage" -> {
                require(parts.size == 2)
                val number = nullable(parts[1])?.toFloat()?.also { require(it.isFinite() && it in 0f..100f) }
                Rating.Percentage(number)
            }
            "Star" -> {
                require(parts.size == 3)
                val maximum = requireNotNull(integer(parts[1], 1, 100))
                val number = nullable(parts[2])?.toFloat()?.also { require(it.isFinite() && it in 0f..maximum.toFloat()) }
                Rating.Star(maximum, number)
            }
            else -> error("Use Heart:true, Thumb:false, Percentage:75, Star:5:4.5, or null. A null rating value marks an unrated item.")
        }
    }
    fun parse(value: String): MediaMetadata = MediaMetadata.Builder().also { builder ->
        parseApiStringMap(value).forEach { (key, entry) ->
            when (key) {
                "artist" -> builder.setArtist(nullable(entry))
                "albumTitle" -> builder.setAlbumTitle(nullable(entry))
                "albumArtist" -> builder.setAlbumArtist(nullable(entry))
                "displayTitle" -> builder.setDisplayTitle(nullable(entry))
                "subtitle" -> builder.setSubtitle(nullable(entry))
                "writer" -> builder.setWriter(nullable(entry))
                "author" -> builder.setAuthor(nullable(entry))
                "composer" -> builder.setComposer(nullable(entry))
                "conductor" -> builder.setConductor(nullable(entry))
                "genre" -> builder.setGenre(nullable(entry))
                "compilation" -> builder.setCompilation(nullable(entry))
                "station" -> builder.setStation(nullable(entry))
                "duration" -> builder.setDuration(nullable(entry)?.toLong()?.also { require(it >= 0) })
                "trackNumber" -> builder.setTrackNumber(integer(entry))
                "totalTrackCount" -> builder.setTotalTrackCount(integer(entry))
                "recordingYear" -> builder.setRecordingYear(integer(entry))
                "recordingMonth" -> builder.setRecordingMonth(integer(entry, 1, 12))
                "recordingDay" -> builder.setRecordingDay(integer(entry, 1, 31))
                "releaseYear" -> builder.setReleaseYear(integer(entry))
                "releaseMonth" -> builder.setReleaseMonth(integer(entry, 1, 12))
                "releaseDay" -> builder.setReleaseDay(integer(entry, 1, 31))
                "discNumber" -> builder.setDiscNumber(integer(entry))
                "totalDiscCount" -> builder.setTotalDiscCount(integer(entry))
                "isBrowsable" -> builder.setIsBrowsable(boolean(entry))
                "isPlayable" -> builder.setIsPlayable(boolean(entry))
                "mediaType" -> builder.setMediaType(nullable(entry)?.let(MediaMetadata.MediaType::valueOf))
                "userRating" -> builder.setUserRating(rating(entry))
                "overallRating" -> builder.setOverallRating(rating(entry))
                else -> error("Unknown media metadata field: $key")
            }
        }
    }.build()
}
