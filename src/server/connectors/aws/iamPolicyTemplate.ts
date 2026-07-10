export const awsIamPolicyTemplate = `
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "config:DescribeConfigurationRecorders",
                "config:DescribeConfigurationRecorderStatus",
                "cloudtrail:DescribeTrails",
                "cloudtrail:GetTrailStatus",
                "iam:GetAccountSummary",
                "iam:GetCredentialReport",
                "s3:GetEncryptionConfiguration"
            ],
            "Resource": "*"
        }
    ]
}
`;
