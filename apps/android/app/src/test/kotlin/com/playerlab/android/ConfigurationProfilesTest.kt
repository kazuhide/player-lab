package com.playerlab.android

import com.bitmovin.player.api.source.SourceType
import org.junit.Assert.*
import org.junit.Test

class ConfigurationProfilesTest {
    private val sdk = "3.171.0"
    private val safeId = "android:com.bitmovin.player.api.ui.PlayerViewConfig.scalingMode"
    private val keyId = "android:com.bitmovin.player.api.PlayerConfig.key"
    private val source = SourceDraft(url = "https://example.invalid/private.mpd?token=do-not-store", type = SourceType.Dash,
        title = "private-title", posterUrl = "https://example.invalid/poster?token=do-not-store", subtitleUrl = "https://example.invalid/sub?token=do-not-store", subtitleLabel = "private-label")
    private val player = PlayerDraft(muted = true, startupThreshold = "1", forwardDuration = "30", preferredAudioLanguages = "ja, en", httpRetryDelays = "none")
    private fun profile(name: String = "Buffer test") = ConfigurationProfiles.capture(name, sdk, source, player,
        mapOf(safeId to "Zoom", keyId to "do-not-store-license", "android:com.bitmovin.player.api.ui.UiConfig.WebUi.customOptions" to "do-not-store-options"))
    private class MemoryStorage(var value: String? = null) : ConfigurationProfileStorage {
        var writable = true
        override fun read() = value
        override fun write(value: String?): Boolean { if (!writable) return false; this.value = value; return true }
    }
    private fun assertProblem(problem: ConfigurationProfileProblem, action: () -> Unit) {
        try { action(); fail("Expected $problem") } catch (error: ConfigurationProfileException) { assertEquals(problem, error.problem) }
    }

    @Test fun namedProfilesPersistAcrossRepositoriesAndDeletionSurvivesRestart() {
        val storage = MemoryStorage()
        val first = ConfigurationProfileRepository(storage, sdk)
        first.save(profile())
        first.save(profile("字幕の比較"))
        val restarted = ConfigurationProfileRepository(storage, sdk)
        assertEquals(listOf("Buffer test", "字幕の比較"), restarted.list().map { it.name })
        assertEquals(player, restarted.list().first().player)
        restarted.delete("Buffer test")
        assertEquals(listOf("字幕の比較"), ConfigurationProfileRepository(storage, sdk).list().map { it.name })
        assertProblem(ConfigurationProfileProblem.Missing) { restarted.delete("missing") }
    }

    @Test fun payloadContainsOnlyExplicitSafeFieldsAndKnownPublicPresetIds() {
        val result = profile()
        val encoded = ConfigurationProfiles.encode(listOf(result), sdk)
        assertFalse(encoded.contains("do-not-store")); assertFalse(encoded.contains("private-title")); assertFalse(encoded.contains("private-label"))
        assertFalse(encoded.contains("https:")); assertFalse(encoded.contains(keyId))
        assertEquals(mapOf(safeId to "Zoom"), result.overrides)
        assertNull(result.source.preset)
        val preset = Sources.all.first { it.id == "vod-hls" }
        val builtIn = ConfigurationProfiles.capture("Public sample", sdk, SourceDraft(url = preset.url, type = preset.type), player, emptyMap())
        assertEquals(preset.id, builtIn.source.preset)
        assertFalse(ConfigurationProfiles.encode(listOf(builtIn), sdk).contains(preset.url))
    }

    @Test fun restoreChangesDraftsOnlyAndPreservesExcludedCurrentValues() {
        val state = ConfigurationWorkspaceState(SourceSettings("https://example.invalid/current.mpd", SourceType.Dash, title = "Current title"), PlayerSettings())
        val applied = ApiOverrides(mapOf(keyId to "current-runtime-license", safeId to "Fit"))
        val overrides = ApiConfigurationWorkspaceState(applied)
        val sourceBase = state.sourceBase; val playerBase = state.playerBase
        ConfigurationProfiles.restore(profile(), sdk, state, overrides)
        assertEquals(player, state.player)
        assertEquals("https://example.invalid/current.mpd", state.source.url)
        assertEquals("Current title", state.source.title)
        assertEquals("current-runtime-license", overrides.values[keyId])
        assertEquals("Zoom", overrides.values[safeId])
        assertEquals(sourceBase, state.sourceBase); assertEquals(playerBase, state.playerBase)
        assertEquals("Fit", applied.values[safeId])
        assertTrue(state.sourceErrors.isEmpty()); assertTrue(state.playerErrors.isEmpty())
    }

    @Test fun restoringPublicPresetStagesItsUrlWithoutChangingAppliedBase() {
        val preset = Sources.all.first { it.id == "vod-hls" }
        val saved = ConfigurationProfiles.capture("Public sample", sdk, SourceDraft(url = preset.url, type = preset.type), player, emptyMap())
        val original = SourceSettings("https://example.invalid/current.mpd", SourceType.Dash)
        val state = ConfigurationWorkspaceState(original, PlayerSettings())
        ConfigurationProfiles.restore(saved, sdk, state, ApiConfigurationWorkspaceState(ApiOverrides()))
        assertEquals(preset.url, state.source.url); assertEquals(preset.type, state.source.type)
        assertEquals(original, state.sourceBase)
    }

    @Test fun sdkMismatchRequiresConfirmationButKnownFieldsRemainUsable() {
        val saved = profile().copy(sdkVersion = "3.170.0")
        val decoded = ConfigurationProfiles.decode(ConfigurationProfiles.encode(listOf(saved), sdk)).single()
        val state = ConfigurationWorkspaceState(SourceSettings("https://example.invalid/current.mpd", SourceType.Dash), PlayerSettings())
        val previous = state.player
        assertProblem(ConfigurationProfileProblem.SdkConfirmation) { ConfigurationProfiles.restore(decoded, sdk, state, ApiConfigurationWorkspaceState(ApiOverrides())) }
        assertEquals(previous, state.player)
        ConfigurationProfiles.restore(decoded, sdk, state, ApiConfigurationWorkspaceState(ApiOverrides()), confirmSdkChange = true)
        assertEquals(player, state.player)
    }

    @Test fun oldFuturePlatformUnknownFieldsAndUnsafeOverridesAreRejected() {
        val encoded = ConfigurationProfiles.encode(listOf(profile()), sdk)
        val envelope = ApiRecordValues.decode(encoded).single()
        for (version in listOf("0", "2")) assertProblem(ConfigurationProfileProblem.Version) {
            ConfigurationProfiles.decode(ApiRecordValues.encode(listOf(envelope + ("schemaVersion" to version))))
        }
        assertProblem(ConfigurationProfileProblem.Platform) { ConfigurationProfiles.decode(ApiRecordValues.encode(listOf(envelope + ("platform" to "ios")))) }
        assertProblem(ConfigurationProfileProblem.Unsupported) { ConfigurationProfiles.decode(ApiRecordValues.encode(listOf(envelope + ("licenseKey" to "do-not-store")))) }
        val records = ApiRecordValues.decode(envelope.getValue("profiles"))
        val unsafe = records.single() + ("overrides" to ApiRecordValues.encode(listOf(mapOf(keyId to "do-not-store"))))
        assertProblem(ConfigurationProfileProblem.Unsupported) { ConfigurationProfiles.decode(ApiRecordValues.encode(listOf(envelope + ("profiles" to ApiRecordValues.encode(listOf(unsafe)))))) }
        assertProblem(ConfigurationProfileProblem.Invalid) { ConfigurationProfiles.decode("malformed") }
        assertProblem(ConfigurationProfileProblem.Invalid) { ConfigurationProfiles.capture("Invalid", sdk, source, player.copy(startupThreshold = "NaN"), emptyMap()) }
        assertProblem(ConfigurationProfileProblem.Unsupported) { ConfigurationProfiles.capture("Unknown", sdk, source, player, mapOf("unknown.sdk.setting" to "true")) }
    }

    @Test fun namesCapacityDuplicatesMalformedTypesAndWriteFailureDoNotDiscardSavedProfiles() {
        val storage = MemoryStorage(); val repository = ConfigurationProfileRepository(storage, sdk)
        repository.save(profile())
        assertProblem(ConfigurationProfileProblem.Name) { repository.save(profile(" ")) }
        assertProblem(ConfigurationProfileProblem.Name) { repository.save(profile("x".repeat(49))) }
        assertProblem(ConfigurationProfileProblem.Name) { repository.save(profile("Bearer do-not-store")) }
        assertProblem(ConfigurationProfileProblem.Exists) { repository.save(profile("buffer TEST")) }
        for (index in 2..20) repository.save(profile("Case $index"))
        assertProblem(ConfigurationProfileProblem.Limit) { repository.save(profile("Overflow")) }
        storage.writable = false
        val previous = storage.value
        assertProblem(ConfigurationProfileProblem.Storage) { repository.delete("Buffer test") }
        assertEquals(previous, storage.value)
        assertEquals(20, ConfigurationProfileRepository(storage, sdk).list().size)
        val envelope = ApiRecordValues.decode(requireNotNull(previous)).single()
        val records = ApiRecordValues.decode(envelope.getValue("profiles")); val record = records.first()
        val values = ApiRecordValues.decode(record.getValue("player")).single() + ("muted" to "yes")
        val invalid = record + ("player" to ApiRecordValues.encode(listOf(values)))
        assertProblem(ConfigurationProfileProblem.Invalid) { ConfigurationProfiles.decode(ApiRecordValues.encode(listOf(envelope + ("profiles" to ApiRecordValues.encode(listOf(invalid)))))) }
    }

    @Test fun restoringAnUnsetSafeOverrideRemovesLaterEditsButRetainsExcludedDrafts() {
        val saved = ConfigurationProfiles.capture("Defaults", sdk, source, player, emptyMap())
        val state = ConfigurationWorkspaceState(SourceSettings("https://example.invalid/current.mpd", SourceType.Dash), PlayerSettings())
        val staged = ApiConfigurationWorkspaceState(ApiOverrides(mapOf(safeId to "Zoom", keyId to "runtime-license")))
        staged.inputs = staged.inputs + (safeId to "Stretch")
        ConfigurationProfiles.restore(saved, sdk, state, staged)
        assertFalse(safeId in staged.values); assertFalse(safeId in staged.inputs)
        assertEquals("runtime-license", staged.values[keyId]); assertEquals("runtime-license", staged.inputs[keyId])
        assertEquals(SourceSettings("https://example.invalid/current.mpd", SourceType.Dash), state.sourceBase)
    }

    @Test fun everySavedAdvancedFieldHasAConcretePrimitiveSchemaAndNoExecutableOrSecretAdapter() {
        for (id in ConfigurationProfiles.overrideIds) {
            val field = ApiSettings.byId.getValue(id)
            assertTrue(field.kind in setOf(ApiValueKind.Boolean, ApiValueKind.Integer, ApiValueKind.LongInteger, ApiValueKind.Decimal, ApiValueKind.FloatDecimal, ApiValueKind.Choice))
            assertFalse(field.secret); assertFalse(field.drmParameter)
            assertNull(field.playerCallback); assertNull(field.sourceCallback)
        }
        val sensitive = ApiSettings.fields.filter { it.secret || it.drmParameter || it.kind in setOf(ApiValueKind.Text, ApiValueKind.TextList, ApiValueKind.StringMap, ApiValueKind.Records, ApiValueKind.Script) }
            .associate { it.id to "do-not-store-secret-or-code" }
        val captured = ConfigurationProfiles.capture("Safe subset", sdk, source, player, sensitive)
        assertTrue(captured.overrides.isEmpty())
        assertFalse(ConfigurationProfiles.encode(listOf(captured), sdk).contains("do-not-store"))
    }

    @Test fun explicitReplacementIsRequiredAndStorageErrorsDoNotExposeDetails() {
        val storage = MemoryStorage(); val repository = ConfigurationProfileRepository(storage, sdk)
        repository.save(profile())
        val changed = profile().copy(player = player.copy(muted = false))
        assertProblem(ConfigurationProfileProblem.Exists) { repository.save(changed) }
        assertTrue(repository.list().single().player.muted)
        repository.save(changed, replace = true)
        assertFalse(ConfigurationProfileRepository(storage, sdk).list().single().player.muted)
        val broken = object : ConfigurationProfileStorage {
            override fun read(): String? = error("private filesystem or account details")
            override fun write(value: String?): Boolean = error("private filesystem or account details")
        }
        assertProblem(ConfigurationProfileProblem.Storage) { ConfigurationProfileRepository(broken, sdk).list() }
        assertProblem(ConfigurationProfileProblem.Storage) { ConfigurationProfileRepository(broken, sdk).clear() }
        assertProblem(ConfigurationProfileProblem.Limit) { ConfigurationProfiles.decode("x".repeat(ConfigurationProfiles.MAX_STORE_BYTES + 1)) }
        assertProblem(ConfigurationProfileProblem.Invalid) { ConfigurationProfiles.decode(ConfigurationProfiles.encode(listOf(profile()), sdk) + "extra") }
    }


    @Test fun unicodeNamesUseCodePointsAndErrorMessagesHaveLocaleResources() {
        assertEquals("映像　設定（通常）", ConfigurationProfiles.name(" 映像　設定（通常） "))
        val extendedCjk = String(Character.toChars(0x20bb7))
        assertEquals(extendedCjk.repeat(48), ConfigurationProfiles.name(extendedCjk.repeat(48)))
        assertProblem(ConfigurationProfileProblem.Name) { ConfigurationProfiles.name(extendedCjk.repeat(49)) }
        assertProblem(ConfigurationProfileProblem.Name) { ConfigurationProfiles.name("Bearer　private") }
        assertProblem(ConfigurationProfileProblem.Name) { ConfigurationProfiles.name("https://example.invalid") }
        assertProblem(ConfigurationProfileProblem.Name) { ConfigurationProfiles.name("line\nname") }
        assertEquals("é", ConfigurationProfiles.name("e\u0301"))
        assertTrue(ConfigurationProfileProblem.entries.all { it.text in UiTextCatalog.resources })
    }

    @Test fun namesRejectCredentialsAcrossAsciiAndUnicodeSpaceSeparators() {
        assertEquals("Source", ConfigurationProfiles.name("Source"))
        assertEquals("Buffer\u00a0comparison", ConfigurationProfiles.name("Buffer\u00a0comparison"))
        for (space in listOf(" ", "\u00a0", "\u2007", "\u2009", "\u202f", "\u3000")) {
            assertProblem(ConfigurationProfileProblem.Name) { ConfigurationProfiles.name("bEaReR${space}fixture") }
        }
        for (credential in listOf("01234567-89ab-cdef-0123-456789abcdef", "x".repeat(32), "BITMOVIN_API_KEY=fixture")) {
            assertProblem(ConfigurationProfileProblem.Name) { ConfigurationProfiles.name(credential) }
        }
    }

}
