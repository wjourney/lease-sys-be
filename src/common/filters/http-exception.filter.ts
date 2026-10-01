import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z } from "zod";
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (e instanceof z.ZodError)
      return res.status(400).json({
        code: "VALIDATION",
        message: e.issues
          .map((x) => `${x.path.join(".")}: ${x.message}`)
          .join("；"),
        fieldErrors: e.issues,
      });
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      const conflict = ["P2002", "P2003", "P2004", "P2010", "P2034"].includes(
        e.code,
      );
      return res.status(conflict ? 409 : 400).json({
        code: e.code,
        message: conflict
          ? "操作与现有记录冲突，请检查重复数据、租期或关联关系"
          : "数据操作失败",
      });
    }
    if (e instanceof HttpException)
      return res
        .status(e.getStatus())
        .json({ code: "BUSINESS", message: e.message });
    console.error(e);
    res
      .status(500)
      .json({ code: "INTERNAL", message: "服务暂时无法完成操作，请稍后重试" });
  }
}
