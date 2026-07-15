# Dharma — Terraform (AWS EKS)

Provisions an EKS cluster (VPC + managed node groups) and deploys Dharma plus
optional monitoring/logging via Helm.

## Design notes (deviations from the original spec, and why)

- **Community modules, not empty custom `modules/*`.** Uses
  `terraform-aws-modules/vpc/aws` (~> 5.8) and `.../eks/aws` (~> 20.0) — the
  battle-tested standard — instead of the empty `modules/eks`, `modules/vpc`, …
  placeholders in the spec (which would fail `terraform init`).
- **`aws_eks_cluster_auth`, not `aws_eks_auth`.** The spec's `data "aws_eks_auth"`
  does not exist as a Terraform data source; corrected here.
- **Single backend.** Backend is declared only in `backend.tf` (the spec declared
  it in both `versions.tf` and `backend.tf`, which conflicts).
- **`cluster_certificate_authority_data`** is the EKS module's CA output (the spec
  used `cluster_ca_certificate`).
- **Monitoring/logging** are real `helm_release` resources (kube-prometheus-stack,
  loki-stack), not empty module stubs.
- **Single root module** at `terraform/`, selected per-env with `-var-file`
  (rather than `cd environments/prod`).

## Validation status

- ✅ `terraform fmt -recursive` — clean
- ✅ `terraform init -backend=false` — providers + modules resolve
- ✅ `terraform validate` — **"Success! The configuration is valid."**
- ⚠️ **`terraform plan` has NOT been run** — it needs real AWS credentials and the
  S3 state backend (bucket `dharma-terraform-state` + DynamoDB lock table), which
  don't exist in this environment. Nothing has been provisioned. Treat this as
  validated-but-unapplied IaC.

## Usage

```bash
cd terraform

# One-time: create the S3 state bucket + DynamoDB lock table named in backend.tf,
# then:
terraform init

export TF_VAR_grafana_admin_password='...'      # sensitive, not in tfvars
terraform plan  -var-file=environments/prod/terraform.tfvars -out=tfplan
terraform show tfplan | less                     # REVIEW before applying
terraform apply tfplan                           # only after review

# Point kubectl at the new cluster (see the `configure_kubectl` output)
```

`helm_release.dharma` installs the local chart at `../helm/dharma`, overlaying
`helm-values-<env>.yaml`. Provide app secrets via an existing Kubernetes Secret
(`secrets.existingSecret`), not via committed values.

Commit `.terraform.lock.hcl`; the `.terraform/` provider cache and any `*.tfstate`
are gitignored.
