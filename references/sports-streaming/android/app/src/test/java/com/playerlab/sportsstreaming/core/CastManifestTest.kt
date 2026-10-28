package com.playerlab.sportsstreaming.core

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

class CastManifestTest {
    @Test fun castOptionsProviderAndControllerAreRegistered() {
        val file = File(requireNotNull(System.getProperty("sports.manifest")))
        val factory = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = true
            setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
        }
        val document = factory.newDocumentBuilder().parse(file)
        val namespace = "http://schemas.android.com/apk/res/android"
        val entries = document.getElementsByTagName("meta-data")
        val providers = (0 until entries.length).map { entries.item(it) }.filter {
            it.attributes.getNamedItemNS(namespace, "name")?.nodeValue ==
                "com.google.android.gms.cast.framework.OPTIONS_PROVIDER_CLASS_NAME"
        }
        assertEquals(1, providers.size)
        assertEquals("com.bitmovin.player.casting.BitmovinCastOptionsProvider",
            providers.single().attributes.getNamedItemNS(namespace, "value")?.nodeValue)
        val activities = document.getElementsByTagName("activity")
        assertTrue((0 until activities.length).map { activities.item(it) }.any {
            it.attributes.getNamedItemNS(namespace, "name")?.nodeValue == "com.bitmovin.player.casting.ExpandedControllerActivity"
        })
    }
}
