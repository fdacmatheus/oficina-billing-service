import { Logger } from '@nestjs/common';

// Os testes exercitam caminhos de erro de proposito; o log so polui a saida.
Logger.overrideLogger(false);
