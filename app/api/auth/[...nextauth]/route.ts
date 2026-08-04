import bcrypt from "bcrypt";
import NextAuth, { type NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
export const authOptions:NextAuthOptions={providers:[CredentialsProvider({name:"Credentials",credentials:{email:{label:"Email",type:"email"},password:{label:"Пароль",type:"password"}},async authorize(credentials){if(!credentials?.email||!credentials.password)return null;const user=await prisma.user.findUnique({where:{email:credentials.email}});if(!user||!user.active||!(await bcrypt.compare(credentials.password,user.password)))return null;await prisma.user.update({where:{id:user.id},data:{lastLogin:new Date()}});return {id:String(user.id),name:user.name,email:user.email,role:user.role};}})],session:{strategy:"jwt"},secret:process.env.NEXTAUTH_SECRET,callbacks:{jwt({token,user}){if(user){token.id=user.id;token.role=(user as {role:string}).role;}return token;},session({session,token}){session.user.id=String(token.id);session.user.role=String(token.role);return session;}}};
const handler=NextAuth(authOptions);export {handler as GET,handler as POST};
