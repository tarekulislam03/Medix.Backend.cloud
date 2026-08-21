import sys
import json
import logging
import os

# ═══ CRITICAL: Disable PIR entirely to bypass oneDNN ArrayAttribute crash ═══
os.environ["FLAGS_enable_pir_api"] = "0"
os.environ["FLAGS_enable_pir_in_executor"] = "0"
os.environ["FLAGS_enable_pir_with_pt_in_dy2st"] = "0"
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["GLOG_minloglevel"] = "3"
os.environ["FLAGS_call_stack_level"] = "0"

# Must set flags BEFORE importing paddle
import paddle
paddle.set_flags({
    "FLAGS_enable_pir_api": False,
    "FLAGS_enable_pir_in_executor": False,
    "FLAGS_use_mkldnn": False,
})

import paddle.inference as paddle_inference
if not hasattr(paddle_inference.Config, 'set_optimization_level'):
    paddle_inference.Config.set_optimization_level = lambda self, level: None

from paddleocr import PaddleOCR

logging.getLogger("ppocr").setLevel(logging.ERROR)
logging.getLogger("paddlex").setLevel(logging.ERROR)

def run_ocr(image_path):
    ocr = PaddleOCR(use_angle_cls=True, lang='en')
    result = ocr.ocr(image_path)
    
    extracted_lines = []
    if result and len(result) > 0 and result[0] is not None:
        for line in result[0]:
            text = line[1][0]
            confidence = line[1][1]
            extracted_lines.append({"text": text, "confidence": round(confidence, 4)})
            
    return extracted_lines

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No image path specified"}))
        sys.exit(1)
        
    image_path = sys.argv[1]
    try:
        lines = run_ocr(image_path)
        full_text = "\n".join([l["text"] for l in lines])
        avg_conf = sum([l["confidence"] for l in lines]) / max(len(lines), 1)
        print(json.dumps({
            "text": full_text,
            "lines": len(lines),
            "avg_confidence": round(avg_conf * 100, 1),
            "success": True
        }))
    except Exception as e:
        print(json.dumps({"error": str(e), "success": False}))
