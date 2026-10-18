"""Create one S3 output from environment credentials without logging the request."""

import os
from uuid import UUID


def create_output(api=None):
    """Use the SDK's quiet default client; callers supplying a client must do likewise."""
    try:
        from bitmovin_api_sdk import AwsCloudRegion, BitmovinApi, S3Output
    except ImportError:
        raise SystemExit(
            "S3 bootstrap needs the pinned Python SDK: "
            "python3 -m pip install -r encoding/requirements.txt") from None

    required = ("BITMOVIN_API_KEY", "BITMOVIN_OUTPUT_BUCKET",
                "BITMOVIN_OUTPUT_ACCESS_KEY", "BITMOVIN_OUTPUT_SECRET_KEY")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise SystemExit("S3 bootstrap requires: " + ", ".join(missing))

    try:
        # Omitting BitmovinApiLogger keeps request bodies and response data quiet.
        # The SDK's verbose logger includes the S3 credentials in the request.
        if api is None:
            api = BitmovinApi(api_key=os.environ["BITMOVIN_API_KEY"],
                              tenant_org_id=os.environ.get("BITMOVIN_TENANT_ORG_ID"))
        region = os.environ.get("BITMOVIN_OUTPUT_REGION")
        cloud_region = AwsCloudRegion(region.upper().replace("-", "_")) if region else None
        output = api.encoding.outputs.s3.create(s3_output=S3Output(
            name=os.environ.get("BITMOVIN_OUTPUT_NAME", "dvr-showcase-output"),
            bucket_name=os.environ["BITMOVIN_OUTPUT_BUCKET"],
            access_key=os.environ["BITMOVIN_OUTPUT_ACCESS_KEY"],
            secret_key=os.environ["BITMOVIN_OUTPUT_SECRET_KEY"],
            cloud_region=cloud_region))
        UUID(output.id)
        return output
    except Exception:
        # SDK exceptions can retain the complete request payload. Do not print
        # them, chain them, or retry a creation whose outcome may be unknown.
        raise SystemExit(
            "S3 output creation failed. Check configuration and existing outputs "
            "before retrying; use OUTPUT_ID if the resource was already created.") from None


if __name__ == "__main__":
    print(create_output().id)
