# Remote state — single source of truth (do NOT also declare a backend in versions.tf).
# Create the bucket + DynamoDB lock table before `terraform init`, or run
# `terraform init -backend=false` for offline validation.
terraform {
  backend "s3" {
    bucket         = "dharma-terraform-state"
    key            = "dharma/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-lock"
  }
}
