variable "region" {
  description = "Regiao AWS. O AWS Academy so libera us-east-1."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Prefixo dos recursos."
  type        = string
  default     = "oficina-billing"
}

variable "db_name" {
  description = "Nome do banco."
  type        = string
  default     = "billing"
}

variable "db_username" {
  description = "Usuario master do PostgreSQL."
  type        = string
  default     = "billing"
}

variable "db_instance_class" {
  description = "Classe da instancia RDS."
  type        = string
  default     = "db.t3.micro"
}

variable "db_allocated_storage" {
  description = "Armazenamento em GB."
  type        = number
  default     = 20
}
