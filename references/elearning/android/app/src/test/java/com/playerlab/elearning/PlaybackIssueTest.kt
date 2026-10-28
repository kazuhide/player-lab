package com.playerlab.elearning

import org.junit.Assert.*
import org.junit.Test

class PlaybackIssueTest {
    @Test fun captionHttpFailuresRemainDistinctFromSdkCodes() {
        val log = DiagnosticBuffer()
        log.add(DiagnosticKind.CAPTION_HTTP_FAILURE, "EDU-FX-01", 0, UiMode.DEFAULT, httpStatus = 404)
        assertEquals(404, log.entries().single().httpStatus)
        assertNull(log.entries().single().sdkCode)
        assertThrows(IllegalArgumentException::class.java) { log.add(DiagnosticKind.CAPTION_HTTP_FAILURE, "EDU-FX-01", 0, UiMode.DEFAULT, httpStatus = 99) }
        assertThrows(IllegalArgumentException::class.java) { log.add(DiagnosticKind.CAPTION_HTTP_FAILURE, "EDU-FX-01", 0, UiMode.DEFAULT, httpStatus = 600) }
    }

    @Test fun boundedCaptionSignatureCheckAcceptsBomAndRejectsWrongOrOversizedContent() {
        assertTrue(hasWebVttSignature("WEBVTT\n\n".toByteArray()))
        assertTrue(hasWebVttSignature("\uFEFFWEBVTT\r\n".toByteArray()))
        assertFalse(hasWebVttSignature("INVALID WEBVTT SIGNATURE\n".toByteArray()))
        assertFalse(hasWebVttSignature("WEBVTTinvalid\n".toByteArray()))
        assertFalse(hasWebVttSignature(ByteArray(1_048_577)))
    }

    @Test fun diagnosticsStoreBoundedPublicCodesAndStableIdsOnly() {
        val log = DiagnosticBuffer()
        log.add(DiagnosticKind.WARNING, "EDU-FX-01", 10_000, UiMode.LEARNING, sdkCode = 1201)
        assertEquals(1201, log.entries().single().sdkCode)
        assertThrows(IllegalArgumentException::class.java) { log.add(DiagnosticKind.WARNING, "EDU-FX-01", 0, UiMode.DEFAULT, sdkCode = -1) }
        assertThrows(IllegalArgumentException::class.java) { log.add(DiagnosticKind.WARNING, "EDU-FX-01", 0, UiMode.DEFAULT, sdkCode = 1_000_000) }
    }

    @Test fun ownedFaultsCannotChooseArbitraryUrlsOrEscapeFixtures() {
        val media = MediaLocator("https://fixtures.example.test/")
        for (fault in OwnedTestFault.entries) {
            fault.mediaPath?.let { assertTrue(media.resolve(it).startsWith("https://fixtures.example.test/")) }
            fault.subtitlePath?.let { assertTrue(media.resolve(it).startsWith("https://fixtures.example.test/")) }
        }
        assertNull(OwnedTestFault.NONE.mediaPath)
        assertNull(OwnedTestFault.NONE.subtitlePath)
        assertEquals("missing/hls/master.m3u8", OwnedTestFault.MEDIA_404.mediaPath)
    }
}
