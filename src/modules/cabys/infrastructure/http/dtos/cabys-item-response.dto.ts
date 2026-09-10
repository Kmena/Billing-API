import { ApiProperty } from '@nestjs/swagger';

export class CabysItemResponseDto {
  @ApiProperty({ example: '5209900000000', description: '13-digit CABYS code' })
  code!: string;

  @ApiProperty({ example: 'Mercancías de consumo corriente, n.e.p.' })
  description!: string;

  @ApiProperty({ example: 13, description: 'Tax rate percentage' })
  taxRate!: number;

  @ApiProperty({ example: 'Mercancías de consumo corriente, n.e.p.' })
  category!: string;
}

export class CabysSearchResponseDto {
  @ApiProperty({ type: [CabysItemResponseDto] })
  items!: CabysItemResponseDto[];

  @ApiProperty({ example: 1199, description: 'Total matching records in Hacienda catalogue' })
  total!: number;
}
