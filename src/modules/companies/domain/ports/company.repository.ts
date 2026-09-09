import { Company } from '../entities/company.entity';

export interface ICompanyRepository {
  findById(id: string): Promise<Company | null>;
  findByIdentificationNumber(tenantId: string, number: string): Promise<Company | null>;
  save(company: Company): Promise<void>;
}

export const COMPANY_REPOSITORY = Symbol('ICompanyRepository');
