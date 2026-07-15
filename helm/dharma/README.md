# Dharma Helm Chart

Application-layer chart for Dharma: the Next.js app (`docker/nextjs/Dockerfile`)
and the BullMQ worker (`docker/worker/Dockerfile`).

## What this chart does and does NOT do

- **Deploys:** app Deployment + Service + HPA + Ingress, worker Deployment, a
  ServiceAccount, and (optionally) a Secret holding connection strings.
- **Does NOT deploy data services.** PostgreSQL/pgvector, Redis, and MinIO must
  already exist (managed service, or the raw manifests in `../../k8s/`). Wire
  their connection details in via `secrets.*` in `values.yaml`, or point at an
  existing Secret with `secrets.existingSecret`.

This keeps the chart self-contained and lintable offline. For an all-in-one
in-cluster stack instead, use the manifests under `k8s/` or add Bitnami
postgresql/redis subchart dependencies to `Chart.yaml`.

## Validation status

- ✅ `helm lint helm/dharma` — passes (0 failures)
- ✅ `helm template dharma helm/dharma` — renders 7 valid resources
- ⚠️ **Not yet deployed to a real cluster.** No `helm install` / server-side
  validation has been run. Image references (`ghcr.io/securitywithhem/dharma*`)
  are placeholders — build & push real images first, or override at install.

## Usage

```bash
# Render manifests to inspect
helm template dharma helm/dharma

# Lint
helm lint helm/dharma

# Install (provide real secrets + image tags via an override file)
helm install dharma helm/dharma -n dharma-prod --create-namespace \
  -f my-values.prod.yaml
```

Provide secrets securely at install time — do not commit real values into
`values.yaml`. Prefer `secrets.existingSecret` pointing at a Sealed Secret / Vault-managed Secret.
