package com.playerlab.android

import com.bitmovin.player.api.offline.DeviceStateRequirement
import org.junit.Assert.*
import org.junit.Test

class ApiOfflineConfigTest {
    @Test fun download_limits_require_positive_whole_ints_before_service_configuration() {
        for (input in listOf("0", "-1", "1.5", "2147483648", "NaN")) {
            assertTrue(runCatching { ApiOfflineConfigDraft(downloads = input).build() }.isFailure)
            assertTrue(runCatching { ApiOfflineConfigDraft(segments = input).build() }.isFailure)
        }
    }

    @Test fun editable_requirements_and_drm_policy_reach_the_public_sdk_config_and_code() {
        val requirements = setOf(DeviceStateRequirement.NetworkUnmetered, DeviceStateRequirement.DeviceCharging)
        val draft = ApiOfflineConfigDraft("2", "7", requirements, false)
        val config = draft.build()
        assertEquals(2, config.maxSimultaneousDownloads)
        assertEquals(7, config.maxSimultaneousSegmentDownloads)
        assertEquals(requirements, config.deviceStateRequirements)
        assertFalse(config.tweaksConfig.shouldAutomaticallyHandleDrmLicenses)
        assertTrue(draft.code().contains("DeviceStateRequirement.DeviceCharging"))
        assertTrue(draft.code().contains("maxSimultaneousSegmentDownloads = 7"))
        assertTrue(ApiOfflineConfigDraft(requirements = emptySet()).build().deviceStateRequirements.isEmpty())
    }
}
