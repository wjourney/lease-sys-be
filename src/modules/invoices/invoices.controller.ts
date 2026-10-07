import { InvoiceBatchService } from "./invoice-batch.service";
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { InvoiceEmailService } from "./invoice-email.service";
import { InvoiceLifecycleService } from "./invoice-lifecycle.service";
import { InvoiceRenderService } from "./invoice-render.service";
import { InvoicesService } from "./invoices.service";
@ApiTags("invoices")
@Controller("invoices")
export class InvoicesController {
  constructor(
    @Inject(InvoiceBatchService) private batch: InvoiceBatchService,
    @Inject(InvoicesService) private service: InvoicesService,
    @Inject(InvoiceRenderService) private renderer: InvoiceRenderService,
    @Inject(InvoiceLifecycleService) private lifecycle: InvoiceLifecycleService,
    @Inject(InvoiceEmailService) private email: InvoiceEmailService,
  ) {}
  @Post("batch-download") async batchDownload(
    @Req() r: any,
    @Body() body: unknown,
    @Res() res: any,
  ) {
    const result = await this.batch.download(r.actor, body);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="invoices.zip"');
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Invoice-Count", String(result.count));
    res.setHeader("X-Invoice-Issues", String(result.issues));
    res.send(result.zip);
  }
  @Post(":id/render") render(@Req() r: any, @Param("id") key: string) {
    return this.renderer.render(r.actor, key);
  }
  @Post(":id/void") voidInvoice(
    @Req() r: any,
    @Param("id") key: string,
    @Body() d: any,
  ) {
    return this.lifecycle.voidInvoice(r.actor, key, d.reason);
  }
  @Post(":id/reissue") reissue(
    @Req() r: any,
    @Param("id") key: string,
    @Body() d: any,
  ) {
    return this.lifecycle.voidInvoice(r.actor, key, d.reason, true);
  }
  @Post(":id/email-resolution") emailResolution(
    @Req() r: any,
    @Param("id") key: string,
    @Body() d: any,
  ) {
    return this.email.resolveEmail(r.actor, key, d);
  }
  @Post(":id/send") send(
    @Req() r: any,
    @Param("id") key: string,
    @Body() d: any,
  ) {
    return this.email.send(r.actor, key, d);
  }
  @Get() list(@Req() r: any, @Query() q: any) {
    return this.service.list(r.actor, q);
  }
  @Get("export") async export(@Req() r: any, @Query() q: any, @Res() res: any) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="invoices.csv"');
    res.send(await this.service.export(r.actor, q));
  }
  @Get(":id/operations") operations(@Req() r: any, @Param("id") id: string) {
    return this.service.operations(r.actor, id);
  }
  @Get(":id") detail(@Req() r: any, @Param("id") id: string) {
    return this.service.detail(r.actor, id);
  }
  @Post() async create(@Req() r: any, @Body() body: any) {
    return this.service.enrich(
      r.actor,
      await this.service.create(r.actor, body),
    );
  }
  @Patch(":id") async edit(
    @Req() r: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.enrich(
      r.actor,
      await this.service.edit(r.actor, id, body),
    );
  }
  @Delete(":id") async remove(
    @Req() r: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    await this.service.remove(r.actor, id, body.reason);
    return { ok: true };
  }
}
