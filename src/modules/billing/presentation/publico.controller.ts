import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OrcamentosService } from '../application/orcamentos.service';
import { PagamentosService } from '../application/pagamentos.service';
import { PagarDto } from './dto/pagar.dto';
import { apresentarOrcamento, apresentarPagamento } from './presenters';

/** Rotas do link enviado ao cliente. Sem JWT: a protecao e o token do orcamento. */
@ApiTags('publico')
@ApiQuery({ name: 'token', required: true })
@Controller('publico/orcamentos')
export class PublicoController {
  constructor(
    private readonly orcamentos: OrcamentosService,
    private readonly pagamentos: PagamentosService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes do orçamento' })
  async consultar(@Param('id', ParseUUIDPipe) id: string, @Query('token') token: string) {
    return apresentarOrcamento(await this.orcamentos.consultarPublico(id, token));
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cliente aprova o orçamento' })
  async aprovar(@Param('id', ParseUUIDPipe) id: string, @Query('token') token: string) {
    return apresentarOrcamento(await this.orcamentos.aprovar(id, token));
  }

  @Post(':id/recusar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cliente recusa o orçamento' })
  async recusar(@Param('id', ParseUUIDPipe) id: string, @Query('token') token: string) {
    return apresentarOrcamento(await this.orcamentos.recusar(id, token));
  }

  @Post(':id/pagar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Paga com cartão tokenizado (checkout transparente)' })
  async pagar(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('token') token: string,
    @Body() dto: PagarDto,
  ) {
    return apresentarPagamento(await this.pagamentos.pagar(id, token, dto));
  }
}
