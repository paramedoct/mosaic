import { HttpTransport } from "../transports/http";

export type Gk2aData = "ir105" | "vi006" | "wv069" | "rgbt" | "rgbdn";
export type Gk2aArea = "ko" | "ea" | "fd";

export interface Gk2aRequest {
  data: Gk2aData;
  area: Gk2aArea;
  time: Date;
}

interface Gk2aResponse {
  response: {
    header: {
      resultCode: string;
      resultMsg: string;
    };
    body: {
      items: {
        item: {
          "satImgC-file": string[];
        }[];
      };
      pageNo: number;
      numOfRows: number;
      totalCount: number;
    };
  };
}

export class Gk2aProvider {
  private readonly http: HttpTransport;
  private readonly serviceKey: string;

  constructor(http: HttpTransport, serviceKey: string) {
    this.http = http;
    this.serviceKey = serviceKey;
  }

  async getFrames(request: Gk2aRequest): Promise<string[]> {
    const url = new URL(
      "https://apis.data.go.kr/1360000/SatlitImgInfoService/getInsightSatlit"
    );

    url.searchParams.set("serviceKey", this.serviceKey);
    url.searchParams.set("numOfRows", "1000");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("dataType", "JSON");
    url.searchParams.set("sat", "G2");
    url.searchParams.set("data", request.data);
    url.searchParams.set("area", request.area);
    url.searchParams.set("time", request.time.toISOString().slice(0, 10).replaceAll("-", ""));

    const response = await this.http.get(url.toString());
    const json = await response.json() as Gk2aResponse;
    const { header, body } = json.response;
    if (header.resultCode !== "00") {
      throw new Error(`GK2A API: ${header.resultMsg}`);
    }

    return body.items.item.flatMap(item => item["satImgC-file"]);
  }
}
