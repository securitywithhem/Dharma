{{/* Chart name */}}
{{- define "dharma.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully qualified app name */}}
{{- define "dharma.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/* Chart label */}}
{{- define "dharma.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Common labels */}}
{{- define "dharma.labels" -}}
helm.sh/chart: {{ include "dharma.chart" . }}
{{ include "dharma.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Selector labels */}}
{{- define "dharma.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dharma.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Service account name */}}
{{- define "dharma.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "dharma.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Name of the secret to read app/worker env from */}}
{{- define "dharma.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "dharma.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/* Shared env block referencing the secret (app + worker) */}}
{{- define "dharma.secretEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "dharma.secretName" . }}
      key: database-url
- name: REDIS_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "dharma.secretName" . }}
      key: redis-url
- name: MINIO_ENDPOINT
  valueFrom:
    secretKeyRef:
      name: {{ include "dharma.secretName" . }}
      key: minio-endpoint
- name: MINIO_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "dharma.secretName" . }}
      key: minio-access-key
- name: MINIO_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ include "dharma.secretName" . }}
      key: minio-secret-key
- name: NEXTAUTH_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ include "dharma.secretName" . }}
      key: nextauth-secret
{{- end -}}
