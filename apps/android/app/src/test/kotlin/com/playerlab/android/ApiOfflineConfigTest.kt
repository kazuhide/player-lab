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
    @Test fun manualOfflineSourceInputsAreBoundedAndExportNoDrmSessionBytes() {
        val draft = ApiOfflineSourceDraft(drmIdHex = "0010feff", restrictToOffline = true)
        assertArrayEquals(byteArrayOf(0, 16, -2, -1), draft.drmId())
        val bytes = draft.drmId()!!; bytes[0] = 9
        assertEquals(0.toByte(), draft.drmId()!![0])
        draft.validate()
        assertTrue(draft.code().contains("privateDrmIdBytes")); assertFalse(draft.code().contains("0010feff"))
        assertNull(ApiOfflineSourceDraft().drmId())
        for (bad in listOf("", "0", "0x12", "gg", "a".repeat(131074))) assertTrue(runCatching { draft.copy(drmIdHex = bad).validate() }.isFailure)
        for (bad in listOf("../other", "/tmp", "a/b", "a.b", "a".repeat(65))) {
            assertTrue(runCatching { draft.copy(cacheFolder = bad).validate() }.isFailure)
            assertTrue(runCatching { draft.copy(trackStateFile = bad).validate() }.isFailure)
        }
    }
}
