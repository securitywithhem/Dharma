environment        = "prod"
aws_region         = "us-east-1"
cluster_name       = "dharma-prod-cluster"
kubernetes_version = "1.29"
vpc_cidr           = "10.0.0.0/16"
enable_monitoring  = true
enable_logging     = true
# grafana_admin_password set via: export TF_VAR_grafana_admin_password=...
