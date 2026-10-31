package com.playerlab.android

import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Name validation must work with Android's regex engine as well as the host JVM. */
@RunWith(AndroidJUnit4::class)
class ConfigurationProfilesNativeInstrumentedTest {
    @Test fun namesWorkOnAndroidAndRejectCredentialLikeInput() {
        assertEquals("Source", ConfigurationProfiles.name("Source"))
        assertEquals("映像\u00a0設定", ConfigurationProfiles.name("映像\u00a0設定"))
        for (space in listOf(" ", "\u00a0", "\u2007", "\u2009", "\u202f", "\u3000")) {
            assertNameRejected("bEaReR${space}fixture")
        }
        assertNameRejected("01234567-89ab-cdef-0123-456789abcdef")
        assertNameRejected("x".repeat(32))
        assertNameRejected("BITMOVIN_API_KEY=fixture")
    }

    @Test fun actualAppDefaultDraftsCanBeCapturedWithoutChangingAppliedSettings() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                val controller = activity.controller
                val owner = controller.player
                val appliedSource = controller.configuredSource
                val sourceSettings = controller.sourceSettings
                val playerSettings = controller.playerSettings
                val source = SourceDraft.from(sourceSettings)
                val player = PlayerDraft.from(playerSettings)
                assertNotNull("Default source validation", source.validate().value)
                assertNotNull("Default player validation", player.validate().value)
                val profile = ConfigurationProfiles.capture("Source", BuildConfig.PLAYER_SDK_VERSION, source, player, emptyMap())
                assertEquals("Source", profile.name)
                assertEquals(player, profile.player)
                assertSame(owner, controller.player)
                assertSame(appliedSource, controller.configuredSource)
                assertEquals(sourceSettings, controller.sourceSettings)
                assertEquals(playerSettings, controller.playerSettings)
            }
        }
    }

    private fun assertNameRejected(value: String) {
        try {
            ConfigurationProfiles.name(value)
            fail("Credential-like profile names must be rejected.")
        } catch (error: ConfigurationProfileException) {
            assertEquals(ConfigurationProfileProblem.Name, error.problem)
        }
    }
}
