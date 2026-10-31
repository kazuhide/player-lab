package com.playerlab.android

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertTrue
import org.junit.Test
import org.w3c.dom.Element

/** Profiles and the rollback copy left by an interrupted write must remain device-local. */
class ConfigurationProfilesBackupTest {
    private fun rules(file: String): Element = DocumentBuilderFactory.newInstance().apply {
        setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
    }.newDocumentBuilder().parse(File("src/main/res/xml", file)).documentElement

    private fun excludesBothCopies(parent: Element) {
        val exclusions = parent.getElementsByTagName("exclude")
        val sharedPreferences = (0 until exclusions.length).map { exclusions.item(it) as Element }
            .filter { it.getAttribute("domain") == "sharedpref" }.map { it.getAttribute("path") }.toSet()
        assertTrue("The live profile file must not migrate", "configuration-profiles.xml" in sharedPreferences)
        assertTrue("An interrupted-write rollback copy must not migrate", "configuration-profiles.xml.bak" in sharedPreferences)
    }

    @Test fun legacyBackupExcludesProfilesAndInterruptedWriteRollbackCopy() {
        excludesBothCopies(rules("configuration_profile_backup.xml"))
    }

    @Test fun cloudBackupExcludesProfilesAndInterruptedWriteRollbackCopy() {
        val extraction = rules("configuration_profile_extraction.xml")
        excludesBothCopies(extraction.getElementsByTagName("cloud-backup").item(0) as Element)
    }

    @Test fun deviceTransferExcludesProfilesAndInterruptedWriteRollbackCopy() {
        val extraction = rules("configuration_profile_extraction.xml")
        excludesBothCopies(extraction.getElementsByTagName("device-transfer").item(0) as Element)
    }
}
