package com.playerlab.android

import com.bitmovin.player.api.source.SourceType
import com.bitmovin.player.api.source.TimelineReferencePoint
import java.text.Normalizer
import java.util.Locale

internal enum class ConfigurationProfileProblem(val text: String) {
    Name("Use a short profile name without credentials or links."),
    Exists("This profile name already exists."),
    Missing("The selected profile no longer exists."),
    Limit("The profile storage limit has been reached."),
    Version("The saved profile format is not supported."),
    Platform("These profiles belong to another platform."),
    Unsupported("Saved profiles contain unsupported settings. Drafts were not changed."),
    Invalid("Saved profiles or draft values are invalid. Drafts were not changed."),
    Storage("Profile storage is unavailable. The operation was not confirmed."),
    SdkConfirmation("The SDK version differs. Confirm before restoring drafts."),
}
internal class ConfigurationProfileException(val problem: ConfigurationProfileProblem) : IllegalArgumentException(problem.text)
private fun profileError(problem: ConfigurationProfileProblem): Nothing = throw ConfigurationProfileException(problem)

internal data class SavedSourceSettings(
    val preset: String?, val type: SourceType, val posterPersistent: Boolean,
    val startOffset: String, val offsetReference: TimelineReferencePoint?, val liveTargetLatency: String,
    val preferredAudioLanguages: String, val useLegacyMediaSource: Boolean,
) {
    fun draft(base: SourceDraft) = base.copy(
        url = preset?.let { id -> Sources.all.first { it.id == id }.url } ?: base.url,
        type = type, posterPersistent = posterPersistent, startOffset = startOffset, offsetReference = offsetReference,
        liveTargetLatency = liveTargetLatency, preferredAudioLanguages = preferredAudioLanguages, useLegacyMediaSource = useLegacyMediaSource,
    )
}
internal data class ConfigurationProfile(
    val name: String, val sdkVersion: String, val source: SavedSourceSettings,
    val player: PlayerDraft, val overrides: Map<String, String>,
)

/** Versioned app-owned values only. No SDK object, executable input or arbitrary config blob is persisted. */
internal object ConfigurationProfiles {
    const val MAX_PROFILES = 20
    const val MAX_NAME = 48
    const val MAX_PROFILE_BYTES = 8192
    const val MAX_STORE_BYTES = 131072
    private const val SDK = "android:com.bitmovin.player.api."
    // This list is deliberately explicit. A new SDK field is not automatically trusted for persistence.
    val overrideIds: Set<String> = setOf(
        "PlaybackConfig.isTunneledPlaybackEnabled", "PlaybackConfig.handleAudioFocus", "PlaybackConfig.handleAudioBecomingNoisy",
        "PlaybackConfig.seekMode", "PlaybackConfig.audioFilter", "PlaybackConfig.videoFilter",
        "TweaksConfig.languagePropertyNormalization", "TweaksConfig.allowChunklessPreparationForHls",
        "TweaksConfig.disableAudioTracksWhileInBackground", "TweaksConfig.disableVideoTracksWhileInBackground",
        "TweaksConfig.attemptVideoFreezeRecovery", "TweaksConfig.constantBitrateSeekingEnabled", "TweaksConfig.timeChangedInterval",
        "media.AdaptationConfig.initialBandwidthEstimateOverride", "live.LiveConfig.liveEdgeOffset", "live.LiveConfig.minTimeShiftBufferDepth",
        "source.SourceAdaptationConfig.bandwidthFractionAvailableToUse", "live.SourceLiveConfig.minTimeShiftBufferDepth",
        "ui.PlayerViewConfig.hideFirstFrame", "ui.PlayerViewConfig.enableComposeSurfaceSyncWorkaround", "ui.PlayerViewConfig.scalingMode",
        "ui.PlayerViewConfig.surfaceType", "ui.PlayerViewConfig.playerMaxVideoQualityConstraint", "ui.PlayerViewConfig.uiConfig",
        "ui.UiConfig.WebUi.playbackSpeedSelectionEnabled", "ui.UiConfig.WebUi.forceSubtitlesIntoViewContainer",
        "ui.UiConfig.WebUi.focusUiOnInitialization", "ui.UiConfig.WebUi.variant", "vr.VrConfig.isStereo", "vr.VrConfig.vrContentType",
    ).map { SDK + it }.toSet()
    private val envelopeKeys = setOf("schemaVersion", "platform", "sdkVersion", "profiles")
    private val profileKeys = setOf("name", "sdkVersion", "source", "player", "overrides")
    private val sourceKeys = setOf("preset", "type", "posterPersistent", "startOffset", "offsetReference", "liveTargetLatency", "preferredAudioLanguages", "useLegacyMediaSource")
    private val playerKeys = setOf("autoplay", "muted", "timeShift", "startupThreshold", "restartThreshold", "forwardDuration", "maxVideoBitrate", "preload", "rebuffering", "qualityStabilityBalance", "preferredAudioLanguages", "httpRetryDelays")
    private val primitiveKinds = setOf(ApiValueKind.Boolean, ApiValueKind.Integer, ApiValueKind.LongInteger, ApiValueKind.Decimal, ApiValueKind.FloatDecimal, ApiValueKind.Choice)

    private inline fun <T> checked(block: () -> T): T = try { block() }
        catch (error: ConfigurationProfileException) { throw error }
        catch (_: Exception) { profileError(ConfigurationProfileProblem.Invalid) }
    private fun bounded(text: String, maximum: Int) {
        if (text.length > maximum || text.toByteArray(Charsets.UTF_8).size > maximum) profileError(ConfigurationProfileProblem.Limit)
    }
    private fun record(text: String, keys: Set<String>? = null): Map<String, String> {
        val result = ApiRecordValues.decode(text).single()
        if (keys != null && result.keys != keys) profileError(ConfigurationProfileProblem.Unsupported)
        return result
    }
    private fun packed(values: Map<String, String>) = ApiRecordValues.encode(listOf(values))
    private fun sdk(value: String): String {
        if (value.length > 64 || !Regex("[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?").matches(value)) profileError(ConfigurationProfileProblem.Invalid)
        return value
    }
    fun name(value: String): String {
        val normalized = Normalizer.normalize(value.trim(), Normalizer.Form.NFC)
        val points = normalized.codePoints().toArray()
        // Android's ICU-backed regex rejects Java's embedded U flag. Include
        // Unicode space separators explicitly so credential checks stay portable.
        val credential = Regex("(?i)(?:bearer[\\s\\p{Zs}]+.*|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{32,})").matches(normalized)
        if (points.size !in 1..MAX_NAME || credential || !points.any(Character::isLetterOrDigit) || points.any {
                !Character.isLetterOrDigit(it) && Character.getType(it) != Character.NON_SPACING_MARK.toInt() && Character.getType(it) != Character.SPACE_SEPARATOR.toInt() && it !in listOf(45, 46, 95, 40, 41, 0xff08, 0xff09)
            }) profileError(ConfigurationProfileProblem.Name)
        return normalized
    }
    fun sameName(first: String, second: String) = first.lowercase(Locale.ROOT) == second.lowercase(Locale.ROOT)
    private fun languages(value: String) {
        if (value.length > 128 || value.split(',').size > 16 || value.isNotBlank() && value.split(',').any {
                !Regex("[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*").matches(it.trim())
            }) profileError(ConfigurationProfileProblem.Invalid)
    }
    private fun validatePlayer(player: PlayerDraft) {
        val values = playerMap(player)
        if (values.values.any { it.length > 512 } || player.validate().value == null) profileError(ConfigurationProfileProblem.Invalid)
        languages(player.preferredAudioLanguages)
        if (player.httpRetryDelays.split(',').size > 16) profileError(ConfigurationProfileProblem.Invalid)
    }
    private fun validateSource(source: SavedSourceSettings) {
        if (source.preset != null && Sources.all.none { it.id == source.preset && it.type == source.type }) profileError(ConfigurationProfileProblem.Unsupported)
        if (sourceMap(source).values.any { it.length > 128 }) profileError(ConfigurationProfileProblem.Invalid)
        languages(source.preferredAudioLanguages)
        if (source.draft(SourceDraft(url = "https://example.invalid/validation.mpd")).validate().value == null) profileError(ConfigurationProfileProblem.Invalid)
    }
    private fun overrides(values: Map<String, String>): Map<String, String> = values.mapValues { (id, value) ->
        if (id !in overrideIds) profileError(ConfigurationProfileProblem.Unsupported)
        val field = ApiSettings.byId[id] ?: profileError(ConfigurationProfileProblem.Unsupported)
        if (field.kind !in primitiveKinds || field.secret || field.drmParameter || field.playerCallback != null || field.sourceCallback != null) profileError(ConfigurationProfileProblem.Unsupported)
        if (value.length > 128) profileError(ConfigurationProfileProblem.Invalid)
        field.normalize(value)
    }.toMap()

    fun capture(name: String, sdkVersion: String, source: SourceDraft, player: PlayerDraft, overrides: Map<String, String>): ConfigurationProfile = checked {
        if (overrides.keys.any { it !in ApiSettings.byId }) profileError(ConfigurationProfileProblem.Unsupported)
        val preset = Sources.all.firstOrNull { it.url == source.url.trim() && it.type == source.type }?.id
        val saved = SavedSourceSettings(preset, source.type, source.posterPersistent, source.startOffset, source.offsetReference,
            source.liveTargetLatency, source.preferredAudioLanguages, source.useLegacyMediaSource)
        validateSource(saved); validatePlayer(player)
        ConfigurationProfile(name(name), sdk(sdkVersion), saved, player.copy(), overrides(overrides.filterKeys { it in overrideIds }))
    }
    private fun sourceMap(source: SavedSourceSettings) = mapOf(
        "preset" to source.preset.orEmpty(), "type" to source.type.name, "posterPersistent" to source.posterPersistent.toString(),
        "startOffset" to source.startOffset, "offsetReference" to source.offsetReference?.name.orEmpty(), "liveTargetLatency" to source.liveTargetLatency,
        "preferredAudioLanguages" to source.preferredAudioLanguages, "useLegacyMediaSource" to source.useLegacyMediaSource.toString(),
    )
    private fun playerMap(player: PlayerDraft) = mapOf(
        "autoplay" to player.autoplay.toString(), "muted" to player.muted.toString(), "timeShift" to player.timeShift.toString(),
        "startupThreshold" to player.startupThreshold, "restartThreshold" to player.restartThreshold, "forwardDuration" to player.forwardDuration,
        "maxVideoBitrate" to player.maxVideoBitrate, "preload" to player.preload.toString(), "rebuffering" to player.rebuffering.toString(),
        "qualityStabilityBalance" to player.qualityStabilityBalance, "preferredAudioLanguages" to player.preferredAudioLanguages, "httpRetryDelays" to player.httpRetryDelays,
    )
    private fun profileMap(profile: ConfigurationProfile): Map<String, String> {
        if (name(profile.name) != profile.name) profileError(ConfigurationProfileProblem.Name)
        sdk(profile.sdkVersion); validateSource(profile.source); validatePlayer(profile.player)
        return mapOf("name" to profile.name, "sdkVersion" to profile.sdkVersion, "source" to packed(sourceMap(profile.source)),
            "player" to packed(playerMap(profile.player)), "overrides" to packed(overrides(profile.overrides))).also { bounded(packed(it), MAX_PROFILE_BYTES) }
    }
    fun encode(profiles: List<ConfigurationProfile>, writerSdk: String): String = checked {
        if (profiles.size > MAX_PROFILES) profileError(ConfigurationProfileProblem.Limit)
        if (profiles.map { it.name.lowercase(Locale.ROOT) }.distinct().size != profiles.size) profileError(ConfigurationProfileProblem.Exists)
        val records = profiles.map(::profileMap)
        val writer = sdk(writerSdk)
        try {
            packed(mapOf("schemaVersion" to "1", "platform" to "android", "sdkVersion" to writer, "profiles" to ApiRecordValues.encode(records)))
                .also { bounded(it, MAX_STORE_BYTES) }
        } catch (error: ConfigurationProfileException) { throw error }
        catch (_: IllegalArgumentException) { profileError(ConfigurationProfileProblem.Limit) }
    }
    fun decode(value: String): List<ConfigurationProfile> = checked {
        bounded(value, MAX_STORE_BYTES)
        val envelope = record(value, envelopeKeys)
        if (envelope.getValue("schemaVersion") != "1") profileError(ConfigurationProfileProblem.Version)
        if (envelope.getValue("platform") != "android") profileError(ConfigurationProfileProblem.Platform)
        sdk(envelope.getValue("sdkVersion"))
        val records = ApiRecordValues.decode(envelope.getValue("profiles"))
        if (records.size > MAX_PROFILES) profileError(ConfigurationProfileProblem.Limit)
        records.map { item ->
            bounded(packed(item), MAX_PROFILE_BYTES)
            if (item.keys != profileKeys) profileError(ConfigurationProfileProblem.Unsupported)
            val source = record(item.getValue("source"), sourceKeys)
            val player = record(item.getValue("player"), playerKeys)
            val saved = ConfigurationProfile(item.getValue("name"), item.getValue("sdkVersion"), SavedSourceSettings(
                source.getValue("preset").ifBlank { null }, SourceType.valueOf(source.getValue("type")), source.getValue("posterPersistent").toBooleanStrict(),
                source.getValue("startOffset"), source.getValue("offsetReference").ifBlank { null }?.let(TimelineReferencePoint::valueOf),
                source.getValue("liveTargetLatency"), source.getValue("preferredAudioLanguages"), source.getValue("useLegacyMediaSource").toBooleanStrict(),
            ), PlayerDraft(player.getValue("autoplay").toBooleanStrict(), player.getValue("muted").toBooleanStrict(), player.getValue("timeShift").toBooleanStrict(),
                player.getValue("startupThreshold"), player.getValue("restartThreshold"), player.getValue("forwardDuration"), player.getValue("maxVideoBitrate"),
                player.getValue("preload").toBooleanStrict(), player.getValue("rebuffering").toBooleanStrict(), player.getValue("qualityStabilityBalance"),
                player.getValue("preferredAudioLanguages"), player.getValue("httpRetryDelays")), overrides(record(item.getValue("overrides"))))
            profileMap(saved)
            saved
        }.also { profiles -> if (profiles.map { it.name.lowercase(Locale.ROOT) }.distinct().size != profiles.size) profileError(ConfigurationProfileProblem.Exists) }
    }
    fun restore(profile: ConfigurationProfile, currentSdk: String, configuration: ConfigurationWorkspaceState,
                stagedOverrides: ApiConfigurationWorkspaceState, confirmSdkChange: Boolean = false) = checked {
        profileMap(profile)
        if (profile.sdkVersion != currentSdk && !confirmSdkChange) profileError(ConfigurationProfileProblem.SdkConfirmation)
        val source = profile.source.draft(configuration.source)
        val values = stagedOverrides.values.filterKeys { it !in overrideIds } + profile.overrides
        val inputs = stagedOverrides.inputs.filterKeys { it !in overrideIds } + profile.overrides
        configuration.source = source; configuration.player = profile.player.copy()
        configuration.sourceErrors = emptyMap(); configuration.playerErrors = emptyMap(); configuration.message = ""
        stagedOverrides.values = values; stagedOverrides.inputs = inputs; stagedOverrides.error = ""; stagedOverrides.message = ""
    }
}

internal interface ConfigurationProfileStorage {
    fun read(): String?
    fun write(value: String?): Boolean
}

/** All mutations commit one validated envelope before callers replace the displayed list. */
internal class ConfigurationProfileRepository(private val storage: ConfigurationProfileStorage, private val sdkVersion: String) {
    companion object { private val lock = Any() }
    fun list(): List<ConfigurationProfile> = synchronized(lock) {
        val value = try { storage.read() } catch (_: Exception) { profileError(ConfigurationProfileProblem.Storage) }
        if (value == null) emptyList() else ConfigurationProfiles.decode(value)
    }
    fun save(profile: ConfigurationProfile, replace: Boolean = false): List<ConfigurationProfile> = synchronized(lock) {
        val current = list()
        val index = current.indexOfFirst { it.name.lowercase(Locale.ROOT) == profile.name.lowercase(Locale.ROOT) }
        if (index >= 0 && !replace) profileError(ConfigurationProfileProblem.Exists)
        val next = if (index >= 0) current.toMutableList().also { it[index] = profile }.toList() else current + profile
        persist(ConfigurationProfiles.encode(next, sdkVersion)); next
    }
    fun delete(name: String): List<ConfigurationProfile> = synchronized(lock) {
        val current = list(); val next = current.filterNot { it.name == name }
        if (next.size == current.size) profileError(ConfigurationProfileProblem.Missing)
        persist(ConfigurationProfiles.encode(next, sdkVersion)); next
    }
    fun clear() = synchronized(lock) { persist(null) }
    private fun persist(value: String?) {
        val success = try { storage.write(value) } catch (_: Exception) { profileError(ConfigurationProfileProblem.Storage) }
        if (!success) profileError(ConfigurationProfileProblem.Storage)
    }
}
