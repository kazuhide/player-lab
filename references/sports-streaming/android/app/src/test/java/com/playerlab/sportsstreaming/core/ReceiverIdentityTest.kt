package com.playerlab.sportsstreaming.core

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ReceiverIdentityTest {
    @Test fun receiverProtocolIdentityReadsOnlyItsActualSessionAndSourceMetadata() {
        val status = JSONObject().put("mediaSessionId", 42).put("media", JSONObject().put("customData",
            JSONObject().put("metadata", JSONObject().put(SOURCE_LOAD_TOKEN_METADATA_KEY, "source-token"))))
        assertEquals(ReceiverIdentity(42, "source-token"), ReceiverIdentityParser.parse(status))
    }
    @Test fun missingAndInvalidReceiverIdentityRemainUnknown() {
        for (id in listOf(null, "42", -1, 0, 1.5)) {
            val status = JSONObject().put("mediaSessionId", id ?: JSONObject.NULL)
            assertEquals(ReceiverIdentity(null, null), ReceiverIdentityParser.parse(status))
        }
        assertEquals(ReceiverIdentity(null, null), ReceiverIdentityParser.parse(JSONObject()))
    }
    @Test fun arbitraryOrOversizedMetadataCannotBecomeTheSourceIdentity() {
        for (value in listOf(123, "", "a".repeat(81), JSONObject.NULL)) {
            val status = JSONObject().put("mediaSessionId", 7).put("media", JSONObject().put("customData",
                JSONObject().put("metadata", JSONObject().put(SOURCE_LOAD_TOKEN_METADATA_KEY, value))))
            assertEquals(ReceiverIdentity(7, null), ReceiverIdentityParser.parse(status))
        }
    }
}
