environment        = "dev"
aws_region         = "us-east-1"
cluster_name       = "dharma-dev-cluster"
kubernetes_version = "1.29"
vpc_cidr           = "10.2.0.0/16"
enable_monitoring  = false
enable_logging     = false
# grafana_admin_password set via: export TF_VAR_grafana_admin_password=...
