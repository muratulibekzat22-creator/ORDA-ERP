import { Role } from "./roles";

export const permissions = {

  [Role.DIRECTOR]: {
    finance: true,
    profit: true,
    partnerPrice: true,
    companyExpenses: true,
    analytics: true,
    settings: true,
  },

  [Role.MANAGER]: {
    finance: false,
    profit: false,
    partnerPrice: false,
    companyExpenses: false,
    analytics: false,
    settings: false,
  },

  [Role.ACCOUNTANT]: {
    finance: true,
    profit: false,
    partnerPrice: false,
    companyExpenses: true,
    analytics: true,
    settings: false,
  },

  [Role.PARTNER]: {
    finance: false,
    profit: false,
    partnerPrice: false,
    companyExpenses: false,
    analytics: false,
    settings: false,
  },

  [Role.PRODUCTION]: {
    finance: false,
    profit: false,
    partnerPrice: false,
    companyExpenses: false,
    analytics: false,
    settings: false,
  },

};