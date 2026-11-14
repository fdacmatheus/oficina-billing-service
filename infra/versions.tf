terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Configuracao parcial: bucket, key e region vem do pipeline/CLI:
  # terraform init -backend-config="bucket=..." -backend-config="key=oficina-billing/terraform.tfstate" -backend-config="region=us-east-1"
  backend "s3" {}
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Projeto = "oficina"
      Servico = "billing"
    }
  }
}
