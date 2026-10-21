"""Check the original Android inventory against published binary-flavor snapshots."""
import hashlib
import re

from coverage_report import _array, _hash, _id, _load, _official, _require, _text

MODULES = {"player", "player-base", "player-core", "player-ui-web", "player-analytics", "player-media-session"}


def normalize_signature(value):
    """Only the vendor's Media3 package relocation is equivalent."""
    return (value.replace("com.bitmovin.media3.", "MEDIA3.").replace("androidx.media3.", "MEDIA3.")
            .replace("com/bitmovin/media3/", "MEDIA3/").replace("androidx/media3/", "MEDIA3/"))


def validate_variant(contract, application, sdk, sources):
    """Validate a source snapshot without claiming a fresh binary download."""
    version = sdk["version"]
    variants = [version, version + "+jason"]
    _require(contract.get("schemaVersion") == 1 and contract.get("variantsCompared") == variants,
             "Android binary variant version differs.")
    rows = {row["id"]: row for row in application["rows"]}
    _require(contract.get("baseInventoryRows") == len(rows) and contract.get("inventoryUnchanged") is True,
             "Android variant denominator differs.")
    proofs = {source["url"]: source.get("sha256") for source in sdk["sources"]}
    artifacts = {}
    for artifact in _array(contract.get("artifacts")):
        module, flavor = artifact.get("module"), artifact.get("version")
        _require(artifact.get("group") == "com.bitmovin.player" and module in MODULES and flavor in variants,
                 "Unknown Android variant artifact coordinate.")
        key = (module, flavor)
        _require(key not in artifacts, "Duplicate Android variant artifact.")
        artifacts[key] = artifact
        url = ("https://artifacts.bitmovin.com/artifactory/public-releases/com/bitmovin/player/"
               + module + "/" + flavor + "/" + module + "-" + flavor + ".aar")
        _official(artifact.get("officialArtifact"))
        _require(artifact["officialArtifact"] == url, "Android variant artifact URL differs.")
        _hash(artifact.get("aarSha256"))
        _hash(artifact.get("classesJarSha256"))
        _require(proofs.get(url) == artifact["aarSha256"], "Android binary proof is not bound to the report.")
    _require(set(artifacts) == {(module, flavor) for module in MODULES for flavor in variants},
             "Android variant artifact set is incomplete.")
    original = contract.get("sourceArtifact", {})
    _require(original.get("version") == version, "Android standard source version differs.")
    source_url = ("https://artifacts.bitmovin.com/artifactory/public-releases/com/bitmovin/player/"
                  + "player-core/" + version + "/player-core-" + version + "-sources.jar")
    expected_source = next((s.get("sha256") for s in sources["sourceArtifacts"] if s["url"] == source_url), None)
    _hash(original.get("sha256"))
    _require(original["sha256"] == expected_source == proofs.get(source_url),
             "Android standard source provenance differs.")

    owners = contract.get("publicOwners")
    _require(isinstance(owners, dict), "Android public owner signatures are missing.")
    used, seen = set(), set()
    for row in _array(contract.get("rows")):
        identifier = _id(row.get("id"))
        _require(identifier in rows and identifier not in seen and row.get("category") == rows[identifier]["category"],
                 "Android variant API inventory differs.")
        seen.add(identifier)
        owner = _id(row.get("owner"))
        _require(owner in owners and set(owners[owner]) == {"standard", "jason"},
                 "Android variant public owner is missing.")
        used.add(owner)
        signatures = []
        for flavor in ("standard", "jason"):
            lines = _array(owners[owner][flavor])
            _require(bool(lines), "Android variant public signature is empty.")
            signature = "\n".join(_text(line) for line in lines)
            declared = re.search(r"\b(?:class|interface|enum) ([^ <]+)", signature)
            _require(declared is not None and declared.group(1).replace("$", ".") == owner,
                     "Android variant owner declaration differs.")
            signatures.append(signature)
        standard, jason = signatures
        member = identifier.removeprefix("android:").removeprefix(owner + ".").removesuffix("()")
        _require(row.get("member") == member, "Android variant member binding differs.")
        names = [member, "get" + member[:1].upper() + member[1:], "set" + member[:1].upper() + member[1:]]
        if member.startswith("is"):
            names += [member, "set" + member[2:]]
        for label, signature in zip(("standard", "jason"), signatures):
            present = (row["category"] == "event" and member == owner
                       or any(re.search(r"\b" + re.escape(name) + r"\(", signature) for name in names))
            _require(present and row.get(label + "OwnerPresent") is True and row.get(label + "MemberPresent") is True,
                     "Android variant public member is missing.")
        identical = standard == jason
        equivalent = normalize_signature(standard) == normalize_signature(jason)
        _require(equivalent and row.get("relocatedMedia3EquivalentOwnerShape") is True,
                 "Android variant differs beyond Media3 package relocation.")
        _require(row.get("byteIdenticalPublicOwnerShape") is identical
                 and row.get("shapeDifferenceOwner") == (None if identical else owner),
                 "Android variant comparison flags disagree with raw signatures.")
    _require(seen == set(rows) and used == set(owners), "Android variant API or owner set is incomplete.")


def check_android_variant(data, directory, gradle_source):
    application = next(app for app in data["applications"] if app["id"] == "android")
    sdk = next(sdk for sdk in data["sdks"] if sdk["id"] == application["sdkId"])
    coordinates = re.findall(r'implementation\("com\.bitmovin\.player:player:([^"]+)"\)', gradle_source)
    _require(len(coordinates) == 1, "Android application Player coordinate is ambiguous.")
    version = sdk["version"]
    _require(coordinates[0] in (version, version + "+jason"), "Android Player artifact differs from the report.")
    sources = _load(directory / "android/sources.json")
    if coordinates[0] == version:
        _require("appVariant" not in sources, "Android variant metadata belongs to another application flavor.")
        return
    _require(sources.get("appVariant") == "+jason", "Android app flavor provenance is missing.")
    path = directory / "android/variant-contract.json"
    contract = _load(path)
    _hash(sources.get("variantContractSha256"))
    _require(hashlib.sha256(path.read_bytes()).hexdigest() == sources["variantContractSha256"],
             "Android binary variant snapshot has drifted.")
    validate_variant(contract, application, sdk, sources)
