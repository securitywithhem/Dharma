# Secrets management — Sealed Secrets

## Why this exists

Before this change, the only documented path to production secrets was
`k8s/secrets.yaml.template`: copy it, hand-type real values, `kubectl apply -f
secrets.yaml`. That's a manual, undiscoverable step with no forcing function —
which is exactly how this repo ended up with `ENABLE_K8S_DEPLOY` sitting
unset and `KUBE_CONFIG_PRODUCTION` never configured for months: nobody had a
concrete next action to point at.

The fix isn't routing real secret values through CI (or through an AI
assistant, for that matter) — it's making sure CI never needs to see them at
all. Sealed Secrets encrypts a Secret client-side, with a key only your
cluster's controller can decrypt, so the encrypted output is safe to commit
to git. CI (and I) only ever reference the resulting Secret **by name**
(`dharma-app-secrets`), never by value.

## One-time cluster setup

Install the Sealed Secrets controller (does this once per cluster, not per
deploy):

```bash
helm repo add sealed-secrets https://bitnami-labs.github.io/sealed-secrets
helm install sealed-secrets sealed-secrets/sealed-secrets -n kube-system
```

## Creating / rotating the application secret

1. Apply `k8s/namespace.yaml` first if you haven't (creates the `dharma`
   namespace and the NetworkPolicies that gate traffic into it).

2. Generate real values and build a plain (unencrypted, **never commit this
   file**) Secret manifest:

   ```bash
   kubectl create secret generic dharma-app-secrets \
     --namespace dharma \
     --from-literal=database-url="postgresql://dharma:$(openssl rand -base64 24)@postgres:5432/dharma_db" \
     --from-literal=redis-url="redis://:$(openssl rand -base64 24)@redis:6379" \
     --from-literal=minio-endpoint="minio:9000" \
     --from-literal=minio-access-key="$(openssl rand -hex 16)" \
     --from-literal=minio-secret-key="$(openssl rand -base64 24)" \
     --from-literal=nextauth-secret="$(openssl rand -base64 32)" \
     --dry-run=client -o yaml > /tmp/dharma-app-secrets.plain.yaml
   ```

   The keys here must match what `helm/dharma/templates/_helpers.tpl`'s
   `dharma.secretEnv` reads (`database-url`, `redis-url`, `minio-endpoint`,
   `minio-access-key`, `minio-secret-key`, `nextauth-secret`) — same shape as
   `helm/dharma/templates/secret.yaml`, just sourced from a Secret Helm didn't
   create itself.

3. Seal it (requires `kubeseal`, installed from the same
   bitnami-labs/sealed-secrets release as the controller):

   ```bash
   kubeseal --format yaml \
     --namespace dharma \
     < /tmp/dharma-app-secrets.plain.yaml \
     > k8s/sealed/dharma-app-secrets.staging.yaml   # or .production.yaml
   ```

   `scripts/seal-secrets.sh` wraps steps 2–3 with prompts instead of a wall
   of flags — see that script.

4. **Delete the plaintext file** (`rm /tmp/dharma-app-secrets.plain.yaml` —
   `kubeseal`'s whole point is that only the sealed output needs to survive):

   ```bash
   rm /tmp/dharma-app-secrets.plain.yaml
   ```

5. Commit and apply the sealed (encrypted) file:

   ```bash
   git add k8s/sealed/dharma-app-secrets.staging.yaml
   git commit -m "chore(secrets): rotate staging app secret"
   kubectl apply -f k8s/sealed/dharma-app-secrets.staging.yaml
   ```

   The controller decrypts it in-cluster into a regular `dharma-app-secrets`
   Secret. This step is **not** run by CI — do it yourself, deliberately, the
   same way you'd review any other production change. CI's job is to check
   the result exists (see the "Verify application secret exists" step in
   `deploy.yml`) and refuse to deploy if it doesn't, not to create it.

## Rotation

Repeat steps 2–5 with new values. The sealed file's name doesn't change, so
the diff in git shows exactly when a rotation happened, by whom, without ever
showing what the new value is.

## Recovery if the cluster's sealing key is lost

Sealed Secrets ties ciphertext to one controller instance's private key. Back
up that key (`kubectl get secret -n kube-system -l
sealedsecrets.bitnami.com/sealed-secrets-key -o yaml`) somewhere outside the
cluster itself — losing it means every `k8s/sealed/*.yaml` file becomes
undecryptable and every secret must be regenerated and resealed from scratch.
