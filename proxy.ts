import { auth } from "@/auth"
import { NextResponse } from "next/server"

export default auth((request) => {
  if (!request.auth) {
    return NextResponse.redirect(new URL("/login", request.url))
  }
})

export const config = {
  matcher: ["/dashboard/:path*"],
}
