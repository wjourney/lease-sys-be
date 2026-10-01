import { BadRequestException, ForbiddenException } from "@nestjs/common";
export const fail = (message: string): never => {
  throw new BadRequestException(message);
};
export const demand = (condition: any, message = "无权执行此操作") => {
  if (!condition) throw new ForbiddenException(message);
};
