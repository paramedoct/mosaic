import { HttpTransport } from "../transports/http";

export type KecoDustCode = "pm10" | "pm25";

export interface KecoDustRequest {
  code: KecoDustCode;
  time: Date;
}

interface KecoDustResponse {
  response: {
    header: {
      resultCode: string;
      resultMsg: string;
    };
    body: {
      items: {
        "imageUrl7": string;
        "imageUrl8": string;
      }[];
      pageNo: number;
      numOfRows: number;
      totalCount: number;
    };
  };
}

export class KecoDustProvider {
  private readonly http: HttpTransport;
  private readonly serviceKey: string;

  constructor(http: HttpTransport, serviceKey: string) {
    this.http = http;
    this.serviceKey = serviceKey;
  }

  async getFrames(request: KecoDustRequest): Promise<string[]> {
    const url = new URL(
      "https://apis.data.go.kr/B552584/ArpltnInforInqireSvc/getMinuDustFrcstDspth"
    );

    url.searchParams.set("serviceKey", this.serviceKey);
    url.searchParams.set("numOfRows", "1000");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("returnType", "JSON");
    url.searchParams.set("informCode", request.code);
    url.searchParams.set("searchDate", request.time.toISOString().slice(0, 10));
    url.searchParams.set("ver", "1.1");

    const response = await this.http.get(url.toString());
    const json = await response.json() as KecoDustResponse;
    const { header, body } = json.response;
    if (header.resultCode !== "00") {
      throw new Error(`KecoDust API: ${header.resultMsg}`);
    }

    const imageKey = (request.code === "pm10") 
      ? "imageUrl7" 
      : "imageUrl8";

    return [...new Set(body.items.map(item => item[imageKey]))];
  }
}
