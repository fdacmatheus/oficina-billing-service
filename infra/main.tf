# ---------------------------------------------------------------------------
# Rede: VPC default do Learner Lab (evita NAT Gateway pago).
# ---------------------------------------------------------------------------
data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

# ---------------------------------------------------------------------------
# RDS PostgreSQL 16 proprio do billing. Nenhum outro servico le este banco.
# ---------------------------------------------------------------------------
resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "aws_db_subnet_group" "billing" {
  name       = "${var.project}-db-subnets"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_security_group" "db" {
  name        = "${var.project}-db-sg"
  description = "PostgreSQL do billing, acessivel so de dentro da VPC"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_vpc" {
  security_group_id = aws_security_group.db.id
  description       = "PostgreSQL a partir da VPC (nodes do EKS)"
  cidr_ipv4         = data.aws_vpc.default.cidr_block
  from_port         = 5432
  to_port           = 5432
  ip_protocol       = "tcp"
}

resource "aws_vpc_security_group_egress_rule" "db_all" {
  security_group_id = aws_security_group.db.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_db_instance" "billing" {
  identifier     = "${var.project}-postgres"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_subnet_group_name   = aws_db_subnet_group.billing.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false

  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false

  # O Learner Lab nao permite criar a role de monitoramento avancado.
  performance_insights_enabled = false
  monitoring_interval          = 0

  apply_immediately = true
}

resource "aws_secretsmanager_secret" "db" {
  name                    = "oficina/billing/database"
  description             = "Credenciais do PostgreSQL do billing-service"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    DB_HOST     = aws_db_instance.billing.address
    DB_PORT     = tostring(aws_db_instance.billing.port)
    DB_NAME     = var.db_name
    DB_USER     = var.db_username
    DB_PASSWORD = random_password.db.result
  })
}

# ---------------------------------------------------------------------------
# Fila de entrada do billing + DLQ (contrato: maxReceiveCount = 5).
# ---------------------------------------------------------------------------
resource "aws_sqs_queue" "billing_comandos_dlq" {
  name                      = "billing-comandos-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "billing_comandos" {
  name                       = "billing-comandos"
  visibility_timeout_seconds = 30
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 345600

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.billing_comandos_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "billing_comandos_dlq" {
  queue_url = aws_sqs_queue.billing_comandos_dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.billing_comandos.arn]
  })
}

# O AWS Academy nao permite criar roles: o acesso ao SQS sai da LabRole, que ja
# e o perfil dos nodes do EKS. Exposta como output para conferencia.
data "aws_iam_role" "lab" {
  name = "LabRole"
}
