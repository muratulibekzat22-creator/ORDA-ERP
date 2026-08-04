declare module "bcrypt" { export function hash(value:string,rounds:number):Promise<string>; export function compare(value:string,hash:string):Promise<boolean>; }
