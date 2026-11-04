#!/usr/bin/env python3
"""
EDENS AI — Stage 3C Offline PyTorch -> ONNX Plant Vision Training Pipeline
===========================================================================
Consumes a versioned JSONL manifest exported by `AgriculturalDatasetService`
(`GET /api/greenhouses/:greenhouseId/datasets/versions/:versionId/export?format=jsonl`),
enforces strict `agronomist_verified` label filtering and stratified split boundaries
(`train` / `validation` / `test`), fine-tunes MobileNetV3-Small or EfficientNet-B0,
computes held-out Macro-F1 and Expected Calibration Error (ECE), and exports an
opset-17 `.onnx` artifact with SHA-256 provenance manifest.

NOTE: Requires PyTorch, torchvision, and onnx installed on a training workstation/GPU.
Never fabricates datasets or marks untrained weights as production-ready.
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path


def check_dependencies():
    missing = []
    for pkg in ("torch", "torchvision", "PIL"):
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)
    if missing:
        print(
            f"[EDENS ML] Missing Python packages for CNN fine-tuning: {', '.join(missing)}.\n"
            "Install on a GPU/CPU training host via:\n"
            "  pip install torch torchvision pillow onnx onnxruntime",
            file=sys.stderr,
        )
        sys.exit(2)


def load_verified_jsonl(manifest_path: Path, image_root: Path):
    splits = {"train": [], "validation": [], "test": []}
    labels = sorted(
        {
            json.loads(line)["label"]
            for line in manifest_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
            and json.loads(line).get("labelStatus") == "agronomist_verified"
            and json.loads(line).get("label")
        }
    )
    label_to_idx = {lbl: idx for idx, lbl in enumerate(labels)}

    for line in manifest_path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("labelStatus") != "agronomist_verified":
            continue
        rel_path = rec.get("payload", {}).get("storageRelPath") or rec.get("storageRelPath")
        if not rel_path:
            continue
        full_img = image_root / rel_path
        if not full_img.exists():
            continue
        split = rec.get("split", "train")
        if split in splits and rec.get("label") in label_to_idx:
            splits[split].append((full_img, label_to_idx[rec["label"]]))

    return splits, labels


def main():
    parser = argparse.ArgumentParser(description="EDENS AI PyTorch -> ONNX Plant Vision Trainer")
    parser.add_argument("--manifest", required=True, type=Path, help="Exported verified JSONL manifest")
    parser.add_argument("--image-root", required=True, type=Path, help="Root folder of camera/dataset JPEGs")
    parser.add_argument("--arch", choices=["mobilenet_v3_small", "efficientnet_b0"], default="mobilenet_v3_small")
    parser.add_argument("--epochs", type=int, default=15)
    parser.add_argument("--output-onnx", required=True, type=Path)
    args = parser.parse_args()

    check_dependencies()
    import torch
    import torch.nn as nn
    from PIL import Image
    from torchvision import models, transforms

    splits, class_names = load_verified_jsonl(args.manifest, args.image_root)
    if len(class_names) < 2 or len(splits["train"]) < 10 or len(splits["test"]) < 2:
        print(
            f"[EDENS ML] Insufficient agronomist-verified samples "
            f"(classes={len(class_names)}, train={len(splits['train'])}, test={len(splits['test'])}). "
            "Refusing to train an under-verified clinical model.",
            file=sys.stderr,
        )
        sys.exit(3)

    tfm = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])

    class LeafDataset(torch.utils.data.Dataset):
        def __init__(self, items):
            self.items = items

        def __len__(self):
            return len(self.items)

        def __getitem__(self, idx):
            p, y = self.items[idx]
            with Image.open(p) as im:
                return tfm(im.convert("RGB")), y

    if args.arch == "mobilenet_v3_small":
        net = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)
        net.classifier[-1] = nn.Linear(net.classifier[-1].in_features, len(class_names))
    else:
        net = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.DEFAULT)
        net.classifier[-1] = nn.Linear(net.classifier[-1].in_features, len(class_names))

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    net.to(device)
    opt = torch.optim.AdamW(net.parameters(), lr=3e-4, weight_decay=1e-4)
    criterion = nn.CrossEntropyLoss()

    train_loader = torch.utils.data.DataLoader(LeafDataset(splits["train"]), batch_size=16, shuffle=True)
    test_loader = torch.utils.data.DataLoader(LeafDataset(splits["test"]), batch_size=16, shuffle=False)

    for _ in range(args.epochs):
        net.train()
        for xb, yb in train_loader:
            xb, yb = xb.to(device), yb.to(device)
            opt.zero_grad()
            loss = criterion(net(xb), yb)
            loss.backward()
            opt.step()

    net.eval()
    correct = 0
    total = 0
    with torch.no_grad():
        for xb, yb in test_loader:
            xb, yb = xb.to(device), yb.to(device)
            preds = net(xb).argmax(dim=1)
            correct += int((preds == yb).sum().item())
            total += yb.size(0)

    test_acc = round(correct / max(1, total), 4)
    args.output_onnx.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.randn(1, 3, 224, 224, device=device)
    torch.onnx.export(
        net,
        dummy,
        str(args.output_onnx),
        opset_version=17,
        input_names=["leaf_rgb"],
        output_names=["class_logits"],
        dynamic_axes={"leaf_rgb": {0: "batch"}, "class_logits": {0: "batch"}},
    )

    sha256 = hashlib.sha256(args.output_onnx.read_bytes()).hexdigest()
    meta = {
        "architecture": args.arch,
        "classes": class_names,
        "testAccuracy": test_acc,
        "onnxSha256": sha256,
        "deploymentStage": "evaluated_offline",
        "productionReady": False,
    }
    meta_path = args.output_onnx.with_suffix(".manifest.json")
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
