import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../shared/auth/jwt-auth.guard';
import { OrcamentosService } from '../application/orcamentos.service';
import { PagamentosService } from '../application/pagamentos.service';
import { apresentarOrcamento, apresentarPagamento } from './presenters';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class AdminController {
  constructor(
    private readonly orcamentos: OrcamentosService,
    private readonly pagamentos: PagamentosService,
  ) {}

  @Get('orcamentos')
  @ApiQuery({ name: 'osId', required: false })
  @ApiOperation({ summary: 'Lista orçamentos (últimos 100), opcionalmente por OS' })
  async listar(@Query('osId') osId?: string) {
    return (await this.orcamentos.listar(osId)).map(apresentarOrcamento);
  }

  @Get('orcamentos/:id')
  @ApiOperation({ summary: 'Detalhes do orçamento' })
  async buscarOrcamento(@Param('id', ParseUUIDPipe) id: string) {
    return apresentarOrcamento(await this.orcamentos.buscar(id));
  }

  @Get('pagamentos/:id')
  @ApiOperation({ summary: 'Detalhes do pagamento' })
  async buscarPagamento(@Param('id', ParseUUIDPipe) id: string) {
    return apresentarPagamento(await this.pagamentos.buscar(id));
  }
}
