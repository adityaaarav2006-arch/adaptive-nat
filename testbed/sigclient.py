import asyncio, json
from config import SIGNAL


class SigClient:
    async def connect(self):
        for _ in range(50):
            try:
                self.r, self.w = await asyncio.open_connection(*SIGNAL)
                return self
            except OSError:
                await asyncio.sleep(0.05)
        raise RuntimeError("signalling unreachable")

    async def put(self, k, v):
        self.w.write((json.dumps({"op": "put", "k": k, "v": v}) + "\n").encode()); await self.w.drain()
        await self.r.readline()

    async def get(self, k):
        self.w.write((json.dumps({"op": "get", "k": k}) + "\n").encode()); await self.w.drain()
        return json.loads(await self.r.readline())["v"]
