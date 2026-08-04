import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { hasPermission, type Permission } from "./permissions";
import { Role } from "./roles";
export async function requirePermission(permission:Permission){const session=await getServerSession(authOptions);if(!session?.user)return {response:NextResponse.json({error:"Требуется авторизация"},{status:401})};const role=session.user.role as Role;if(!hasPermission(role,permission))return {response:NextResponse.json({error:"Недостаточно прав"},{status:403})};return {session};}
