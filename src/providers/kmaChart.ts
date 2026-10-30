import { HttpTransport } from "../transports/http";

export type KmaChartCode = "3" | "12" | "24";

export interface KmaChartRequest {
  code: KmaChartCode;
  time: Date;
}

interface KmaChartResponse {
  response: {
    header: {
      resultCode: string;
      resultMsg: string;
    };
    body: {
      items: {
        item: {
          "man-file": string[];
        }[];
      };
      pageNo: number;
      numOfRows: number;
      totalCount: number;
    };
  };
}

export class KmaChartProvider {
  private readonly http: HttpTransport;
  private readonly serviceKey: string;

  constructor(http: HttpTransport, serviceKey: string) {
    this.http = http;
    this.serviceKey = serviceKey;
  }

  async getFrames(request: KmaChartRequest): Promise<string[]> {
    const url = new URL(
      "https://apis.data.go.kr/1360000/WthrChartInfoService/getSurfaceChart"
    );

    url.searchParams.set("serviceKey", this.serviceKey);
    url.searchParams.set("numOfRows", "1000");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("dataType", "JSON");
    url.searchParams.set("code", request.code);
    url.searchParams.set("time", request.time.toISOString().slice(0, 10).replaceAll("-", ""));

    const response = await this.http.get(url.toString());
    const json = await response.json() as KmaChartResponse;
    const { header, body } = json.response;
    if (header.resultCode !== "00") {
      throw new Error(`KmaChart API: ${header.resultMsg}`);
    }

    return body.items.item.flatMap(item => item["man-file"]);
  }
}
