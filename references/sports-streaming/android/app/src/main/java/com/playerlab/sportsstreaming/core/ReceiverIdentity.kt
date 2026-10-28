package com.playerlab.sportsstreaming.core

import org.json.JSONObject

const val SOURCE_LOAD_TOKEN_METADATA_KEY = "playerLabSourceLoad"
data class ReceiverIdentity(val mediaSessionId: Long?, val sourceLoadToken: String?)

object ReceiverIdentityParser {
    fun parse(status: JSONObject): ReceiverIdentity {
        val rawId = status.opt("mediaSessionId")
        val id = (rawId as? Number)?.toString()?.toLongOrNull()?.takeIf { it > 0 }
        val rawToken = status.optJSONObject("media")?.optJSONObject("customData")
            ?.optJSONObject("metadata")?.opt(SOURCE_LOAD_TOKEN_METADATA_KEY)
        return ReceiverIdentity(id, (rawToken as? String)?.takeIf { it.length in 1..80 })
    }
}
