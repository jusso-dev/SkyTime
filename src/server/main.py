from fastapi import FastAPI, status

app = FastAPI()

@app.get("/", status_code=status.HTTP_404_NOT_FOUND)
async def root():
    return {"Not found"}