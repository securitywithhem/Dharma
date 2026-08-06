# Dharma Helm Chart

Application-layer chart for Dharma: the Next.js app (`docker/nextjs/Dockerfile`)
and the BullMQ worker (`docker/worker/Dockerfile`).

## What this chart does and does NOT do

- **Deploys:** app Deployment + Service + HPA + Ingress, worker Deployment, a
  ServiceAccount, PodDisruptionBudgets (`podDisruptionBudget.*`), optional
  NetworkPolicies (`networkPolicy.enabled`, needs an enforcing CNI), and
  (optionally) a Secret holding connection strings. Pod annotations can be set
  via `app.podAnnotations` / `worker.podAnnotations`; to export OpenTelemetry
  traces/metrics, set `OTEL_EXPORTER_OTLP_ENDPOINT` in `app.env` / `worker.env`.
- **Does NOT deploy data services.** PostgreSQL/pgvector, Redis, and MinIO must
  already exist (managed service, or the raw manifests in `../../k8s/`). Wire
  their connection details in via `secrets.*` in `values.yaml`, or point at an
  existing Secret with `secrets.existingSecret`.

This keeps the chart self-contained and lintable offline. For an all-in-one
in-cluster stack instead, use the manifests under `k8s/` or add Bitnami
postgresql/redis subchart dependencies to `Chart.yaml`.

## Validation status

- ✅ `helm lint helm/dharma` — passes (0 failures)
- ✅ `helm template dharma helm/dharma` — renders cleanly with default values
  and with `networkPolicy.enabled=true` / `podDisruptionBudget.enabled=true`
  (also enforced in CI by `.github/workflows/infra-validate.yml`)
- ⚠️ **Not yet deployed to a real cluster.** No `helm install` / server-side
  validation has been run. Image references (`ghcr.io/securitywithhem/dharma*`)
  are placeholders — build & push real images first, or override at install.

## CI wiring

`.github/workflows/deploy.yml` runs this chart on every push to `develop`
(staging) and `main` (production), gated on the repo variable
`ENABLE_K8S_DEPLOY` and the `KUBE_CONFIG_STAGING` / `KUBE_CONFIG_PRODUCTION`
environment secrets:

```bash
helm upgrade --install dharma ./helm/dharma \
  --namespace dharma --create-namespace \
  -f ./helm/dharma/values-staging.yaml   # or values-production.yaml
  --set app.image.repository=... --set app.image.tag=... \
  --set worker.image.repository=... --set worker.image.tag=... \
  --wait --timeout 5m --atomic
```

`--atomic` rolls the release back automatically if the new pods don't reach
Ready within `--timeout`. Before this step, CI verifies the
`dharma-app-secrets` Secret already exists in the namespace — this chart
never creates it (`secrets.create: false` in both env values files); see
`docs/ops/secrets-management.md` for how it gets there via Sealed Secrets.

`k8s/nextjs.yaml` and `k8s/ingress.yaml` are deprecated in favor of this
chart. `k8s/namespace.yaml` (Namespace + NetworkPolicies), `k8s/postgres.yaml`,
`k8s/redis.yaml`, and `k8s/minio-ollama-worker.yaml` are **not** — apply
`k8s/namespace.yaml` to a cluster before the first `helm upgrade --install`,
since its default-deny NetworkPolicy is what the allow-rules in that same
file (now updated to match this chart's Pod labels) depend on.

## Usage

```bash
# Render manifests to inspect
helm template dharma helm/dharma -f values-staging.yaml

# Lint
helm lint helm/dharma

# Install locally / manually (CI does this for you on push — see above)
helm install dharma helm/dharma -n dharma --create-namespace \
  -f values-production.yaml \
  --set app.image.tag=<real-tag> --set worker.image.tag=<real-tag>
```

Provide secrets securely at install time — do not commit real values into
`values.yaml`. Both `values-staging.yaml` and `values-production.yaml` set
`secrets.existingSecret: dharma-app-secrets`; create that Secret via
`scripts/seal-secrets.sh` (see `docs/ops/secrets-management.md`), never by
hand-editing these values files.
