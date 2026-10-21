package com.playerlab.android

/** In-memory form state for explicitly declared record schemas. Not executable input. */
internal data class ApiRecordField(
    val name: String,
    val kind: ApiValueKind = ApiValueKind.Text,
    val example: String = "",
    val choices: List<String> = emptyList(),
    val nullable: Boolean = false,
    val minimum: Double? = null,
    val nested: ApiRecordSchema? = null,
)
internal class ApiRecordSchema(val label: String, val fields: List<ApiRecordField>, val minimumItems: Int = 0, val maximumItems: Int = 32) {
    fun defaults(index: Int) = fields.associate { field -> field.name to when {
        field.nested != null -> ApiRecordValues.encode(emptyList())
        field.name == "id" && field.example.isNotEmpty() -> "${field.example}-${index + 1}"
        else -> field.example
    } }
    fun normalize(value: String): String {
        val records = ApiRecordValues.decode(value)
        require(records.size in minimumItems..maximumItems) { "$label needs at least $minimumItems item(s)." }
        return ApiRecordValues.encode(records.map { values ->
            require(values.keys == fields.map { it.name }.toSet()) { "Use the declared $label fields." }
            fields.associate { field ->
                val raw = values.getValue(field.name)
                field.name to (field.nested?.normalize(raw) ?: ApiSetting("record:${field.name}", label,
                    field.kind, "", choices = field.choices, nullable = field.nullable, minimum = field.minimum).normalize(raw))
            }
        })
    }
}
internal object ApiRecordValues {
    private const val LIMIT = 65_536
    fun encode(records: List<Map<String, String>>): String {
        require(records.size <= 32) { "A list supports at most 32 items." }
        fun atom(value: String) = "${value.length}:$value"
        return buildString {
            append(records.size).append(':')
            records.forEach { record ->
                require(record.size <= 32)
                append(record.size).append(':')
                record.forEach { (key, value) -> append(atom(key)).append(atom(value)) }
            }
        }.also { require(it.length <= LIMIT) { "The form exceeds 65536 characters." } }
    }
    fun decode(value: String): List<Map<String, String>> {
        if (value.isEmpty()) return emptyList()
        require(value.length <= LIMIT)
        var cursor = 0
        fun size(maximum: Int): Int {
            val end = value.indexOf(':', cursor)
            require(end >= cursor && end - cursor in 1..6) { "Invalid form state." }
            val number = value.substring(cursor, end).toIntOrNull() ?: error("Invalid form size.")
            require(number in 0..maximum)
            cursor = end + 1
            return number
        }
        fun atom(): String {
            val length = size(LIMIT)
            require(length <= value.length - cursor)
            return value.substring(cursor, cursor + length).also { cursor += length }
        }
        return List(size(32)) {
            val record = linkedMapOf<String, String>()
            repeat(size(32)) { val key = atom(); require(key !in record); record[key] = atom() }
            record
        }.also { require(cursor == value.length) { "Unexpected form state." } }
    }
}
