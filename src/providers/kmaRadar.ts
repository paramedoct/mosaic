import { HttpTransport } from "../transports/http";

export interface KmaRadarRequest {
  time: Date;
}

interface KmaRadarResponse {
  response: {
    header: {
      resultCode: string;
      resultMsg: string;
    };
    body: {
      items: {
        item: {
          "rdr-img-file": string[];
        }[];
      };
      pageNo: number;
      numOfRows: number;
      totalCount: number;
    };
  };
}

export class KmaRadarProvider {
  private readonly http: HttpTransport;
  private readonly serviceKey: string;

  constructor(http: HttpTransport, serviceKey: string) {
    this.http = http;
    this.serviceKey = serviceKey;
  }

  async getFrames(request: KmaRadarRequest): Promise<string[]> {
    const url = new URL(
      "https://apis.data.go.kr/1360000/RadarImgInfoService/getCmpImg"
    );

    url.searchParams.set("serviceKey", this.serviceKey);
    url.searchParams.set("numOfRows", "1000");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("dataType", "JSON");
    url.searchParams.set("data", "CMP_WRC");
    url.searchParams.set("time", request.time.toISOString().slice(0, 10).replaceAll("-", ""));

    const response = await this.http.get(url.toString());
    const json = await response.json() as KmaRadarResponse;
    const { header, body } = json.response;
    if (header.resultCode !== "00") {
      throw new Error(`KmaRadar API: ${header.resultMsg}`);
    }

    return body.items.item.flatMap(item => item["rdr-img-file"]);
  }
}

